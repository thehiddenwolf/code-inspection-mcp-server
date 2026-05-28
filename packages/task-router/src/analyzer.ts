import {
  AnalysisTarget,
  ComplexityScore,
  MetricResult,
  RoutingTier,
  ThresholdOverrides,
} from './types.js';
import { RoutingTable } from './routing-table.js';
import { MetricRegistry } from './metrics/registry.js';

export interface AnalyzerOptions {
  /** Optional threshold overrides for tier boundaries */
  thresholdOverrides?: ThresholdOverrides;
  /** Optional file-system root for resolving relative file paths */
  fsRoot?: string;
}

/**
 * Main analyzer: given an analysis target (file path, code string, or plan),
 * computes an overall complexity score and recommends a model tier.
 */
export class Analyzer {
  private routingTable: RoutingTable;
  private registry: MetricRegistry;

  constructor(options?: AnalyzerOptions) {
    this.routingTable = new RoutingTable(options?.thresholdOverrides);
    this.registry = new MetricRegistry();
  }

  /**
   * Analyze a target and return a full ComplexityScore with tier recommendation.
   */
  async analyze(target: AnalysisTarget): Promise<ComplexityScore> {
    let code: string;
    let language: string | undefined = target.language;

    switch (target.type) {
      case 'file': {
        if (!target.path) {
          throw new Error('Analysis target type "file" requires a "path"');
        }
        code = await this.readFile(target.path);
        if (!language) {
          language = this.inferLanguage(target.path);
        }
        break;
      }
      case 'code': {
        if (!target.code) {
          throw new Error('Analysis target type "code" requires a "code" string');
        }
        code = target.code;
        language = language ?? 'typescript';
        break;
      }
      case 'plan': {
        // Plans don't get code metrics; we use a heuristic based on plan length/structure
        return this.analyzePlan(target.plan ?? '');
      }
      default:
        throw new Error(`Unknown analysis target type: ${target.type}`);
    }

    // Run code-based metrics via registry
    const { total, metrics } = this.registry.runAll(code, language);

    // Weighted total already computed by registry
    const roundedTotal = Math.round(total * 10) / 10;

    const tier = this.routingTable.getTier(roundedTotal);
    const tierDef = this.routingTable.getTierDefinition(roundedTotal);
    const tierName = RoutingTier[tier];

    const reasoning =
      `Overall complexity: ${roundedTotal}/100 → Tier ${tier} (${tierName})\n` +
      metrics.map(m => `  ${m.name}: ${m.score}/100`).join('\n') + '\n' +
      `Recommended tier: ${tierName}\n` +
      `Recommended models: ${tierDef.recommendedModels.join(', ')}\n` +
      `Guidance: ${tierDef.guidance}`;

    return {
      total: roundedTotal,
      metrics,
      tier,
      reasoning,
    };
  }

  /**
   * Analyze an architectural plan (text) using length/structural heuristics.
   */
  private analyzePlan(plan: string): ComplexityScore {
    const lines = plan.split('\n').filter(l => l.trim().length > 0);
    const wordCount = plan.split(/\s+/).filter(w => w.length > 0).length;
    const sectionCount = (plan.match(/^#{1,6}\s/mg) || []).length;
    const bulletCount = (plan.match(/^[*-]\s/gm) || []).length;
    const codeBlockCount = (plan.match(/```/g) || []).length / 2;

    // Heuristic score
    let score = 0;
    const details: string[] = [];

    // Length contributes up to 40 points (at 800+ words)
    const lengthScore = Math.min(40, wordCount / 20);
    score += lengthScore;
    details.push(`Word count: ${wordCount} → ${lengthScore.toFixed(1)} pts`);

    // Section count contributes up to 30 points
    const sectionScore = Math.min(30, sectionCount * 5);
    score += sectionScore;
    details.push(`Sections: ${sectionCount} → ${sectionScore.toFixed(1)} pts`);

    // Code blocks contribute up to 20 points
    const codeScore = Math.min(20, codeBlockCount * 5);
    score += codeScore;
    details.push(`Code blocks: ${codeBlockCount} → ${codeScore.toFixed(1)} pts`);

    // Bullet depth contributes up to 10 points
    const bulletScore = Math.min(10, bulletCount * 2);
    score += bulletScore;
    details.push(`Bullet items: ${bulletCount} → ${bulletScore.toFixed(1)} pts`);

    const roundedTotal = Math.round(score * 10) / 10;
    const tier = this.routingTable.getTier(roundedTotal);
    const tierDef = this.routingTable.getTierDefinition(roundedTotal);
    const tierName = RoutingTier[tier];

    const reasoning =
      `Plan analysis score: ${roundedTotal}/100 → Tier ${tier} (${tierName})\n` +
      `  ${details.join('\n  ')}\n` +
      `Recommended models: ${tierDef.recommendedModels.join(', ')}\n` +
      `Guidance: ${tierDef.guidance}`;

    return {
      total: roundedTotal,
      metrics: [{
        name: 'plan-heuristic',
        score: roundedTotal,
        details: details.join('; '),
      }],
      tier,
      reasoning,
    };
  }

  private async readFile(path: string): Promise<string> {
    try {
      // Try fs.readFile — this may fail in some sandboxed environments
      const fs = await import('node:fs/promises');
      return await fs.readFile(path, 'utf-8');
    } catch {
      // If we can't read the file, throw a clear error
      throw new Error(`Cannot read file: ${path}`);
    }
  }

  private inferLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const extensionMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      dart: 'dart',
      elixir: 'elixir',
      ex: 'elixir',
      exs: 'elixir',
    };
    return extensionMap[ext ?? ''] ?? 'unknown';
  }
}
