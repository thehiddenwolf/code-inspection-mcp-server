import {
  AnalysisTarget,
  ComplexityScore,
  MetricResult,
  RoutingTier,
  ThresholdOverrides,
} from './types.js';
import { RoutingTable } from './routing-table.js';
import { MetricRegistry } from './metrics/registry.js';
import { RouterConfig, loadRouterConfig, DEFAULT_ROUTER_CONFIG } from './router-config.js';
import { estimateComplexity } from './estimator.js';

/**
 * Routing request — what the router accepts to make a decision.
 *
 * Provide either:
 *   - `code` + optional `language` for static analysis routing, OR
 *   - `description` for heuristic-based routing (no source available)
 *   - or both: `code` takes priority, `description` is used for reasoning context
 */
export interface RoutingRequest {
  /** Source code to analyse for metric-based routing */
  code?: string;
  /** Programming language hint */
  language?: string;
  /** Task description for heuristic fallback or context */
  description?: string;
  /** Optional config path override */
  configPath?: string;
  /** Optional inline config overrides (merged with file config) */
  configOverrides?: Partial<RouterConfig>;
}

/**
 * Routing decision — the output of the router containing tier, models,
 * metric breakdown, and explanatory reasoning.
 */
export interface RoutingDecision {
  /** The chosen routing tier */
  tier: RoutingTier;
  /** Human-readable tier label */
  tierLabel: string;
  /** Overall complexity score (0–100) */
  score: number;
  /** Recommended model keys for this tier */
  recommendedModels: string[];
  /** Whether the routing was based on code metrics or heuristic description */
  source: 'code-metrics' | 'description-heuristic';
  /** Individual metric breakdowns */
  metrics: MetricResult[];
  /** Usage guidance for the tier */
  guidance: string;
  /** Human-readable reasoning for the decision */
  reasoning: string;
  /** Effort estimate summary */
  effortEstimate: {
    level: string;
    description: string;
    suggestedTimeframe: string;
  };
}

/**
 * ComplexityClassifier — the routing engine that consumes metric outputs
 * and applies configurable weighting/decision algorithms to select a model tier.
 *
 * Three core metrics drive the primary routing decision:
 *   1. Cyclomatic complexity  — logical branching density
 *   2. LOC impact             — code volume / function-size profile
 *   3. Dependency density     — import density / external coupling ratio
 *
 * Two secondary metrics augment the score:
 *   - Dependencies           — import count with depth penalty
 *   - Interface surface      — exported API surface area
 *
 * Configuration is loaded from a JSON file (see RouterConfig) and can
 * be overridden per-call via configOverrides.
 */
export class ComplexityClassifier {
  private config: RouterConfig;
  private routingTable: RoutingTable;
  private registry: MetricRegistry;

  constructor(config?: RouterConfig) {
    this.config = config ?? { ...DEFAULT_ROUTER_CONFIG };
    this.routingTable = new RoutingTable(this.config.thresholds);
    this.registry = new MetricRegistry(this.config.metricWeights);
  }

  /**
   * Load configuration from a file path, then route the given request.
   * This is the primary entry point — call this with user-facing inputs.
   */
  static async route(request: RoutingRequest): Promise<RoutingDecision> {
    const config = await loadRouterConfig(request.configPath);

    // Merge inline overrides on top of file config
    if (request.configOverrides) {
      Object.assign(config, request.configOverrides);
      if (request.configOverrides.metricWeights) {
        config.metricWeights = {
          ...config.metricWeights,
          ...request.configOverrides.metricWeights,
        };
      }
    }

    const classifier = new ComplexityClassifier(config);
    return classifier.classify(request);
  }

  /**
   * Classify a routing request — determines complexity score, tier, and
   * model recommendations.
   */
  async classify(request: RoutingRequest): Promise<RoutingDecision> {
    // If we have code, use metric-based analysis (primary path)
    if (request.code && request.code.trim().length > 0) {
      return this.classifyCode(request.code, request.language, request.description);
    }

    // Fall back to description heuristic
    if (request.description && request.description.trim().length > 0) {
      return this.classifyDescription(request.description);
    }

    throw new Error(
      'Routing request must provide either "code" (for metric-based analysis) ' +
      'or "description" (for heuristic routing). Both were empty or missing.',
    );
  }

  /**
   * Classify source code using the full metric pipeline.
   * Runs all registered metrics through MetricRegistry, then applies
   * the configured algorithm (weighted | strict) to determine the
   * final complexity score and routing tier.
   *
   * Algorithm modes:
   *   - `weighted` (default): Weighted average across all metrics.
   *     Smooth, good for general-purpose routing.
   *   - `strict`: Max of the three core metrics (cyclomatic, loc-impact,
   *     density). Pessimistic routing — if any single dimension flags
   *     high complexity, the task is bumped up regardless of others.
   *     Use for safety-critical or low-tolerance codebases.
   */
  private classifyCode(
    code: string,
    language?: string,
    description?: string,
  ): RoutingDecision {
    // Run all metrics — the registry uses the configured weights
    const { total, metrics } = this.registry.runAll(code, language);

    // Apply the configured algorithm
    const algorithm = this.config.algorithm ?? 'weighted';
    let finalScore: number;
    let algorithmNote: string;

    if (algorithm === 'strict' && metrics.length > 0) {
      // Strict mode: find the max of the three core metrics
      const coreNames = ['cyclomatic', 'loc-impact', 'density'];
      const coreScores = metrics
        .filter(m => coreNames.includes(m.name))
        .map(m => m.score);

      if (coreScores.length > 0) {
        finalScore = Math.max(...coreScores);
        algorithmNote = `strict (max of core metrics: ${coreScores.join(', ')})`;
      } else {
        // Fallback: no core metrics found, use weighted total
        finalScore = total;
        algorithmNote = 'weighted (fallback — no core metrics available)';
      }
    } else {
      // Weighted mode: use the registry's weighted average (default)
      finalScore = total;
      algorithmNote = 'weighted';
    }

    const roundedTotal = Math.round(finalScore * 10) / 10;
    const tier = this.routingTable.getTier(roundedTotal);
    const tierDef = this.routingTable.getTierDefinition(roundedTotal);
    const tierLabel = RoutingTier[tier];

    // Build reasoning with algorithm context
    const reasoning = this.buildCodeReasoning(
      roundedTotal,
      tier,
      tierLabel,
      tierDef,
      metrics,
      description,
      algorithmNote,
    );

    return {
      tier,
      tierLabel,
      score: roundedTotal,
      recommendedModels: tierDef.recommendedModels,
      source: 'code-metrics',
      metrics,
      guidance: tierDef.guidance,
      reasoning,
      effortEstimate: this.estimateEffort(roundedTotal, tierLabel),
    };
  }

  /**
   * Classify a task description using heuristic analysis.
   * Uses keyword and word-count heuristics rather than code metrics.
   */
  private classifyDescription(description: string): RoutingDecision {
    const estimate = estimateComplexity(description);

    // Map heuristic complexity to a score range
    const complexityToScore: Record<string, number> = {
      simple: 10,
      medium: 28,
      complex: 60,
    };

    const score = complexityToScore[estimate.complexity] ?? 10;
    const tier = this.routingTable.getTier(score);
    const tierDef = this.routingTable.getTierDefinition(score);
    const tierLabel = RoutingTier[tier];

    // Build a single heuristic metric result
    const metrics: MetricResult[] = [
      {
        name: 'description-heuristic',
        score,
        details: estimate.reasoning,
      },
    ];

    const reasoning =
      `Description-based routing (no source code available)\n` +
      `  Heuristic analysis: ${estimate.complexity} (confidence: ${(estimate.confidence * 100).toFixed(0)}%)\n` +
      `  Estimated complexity score: ${score}/100 → Tier ${tier} (${tierLabel})\n` +
      `  ${estimate.reasoning}\n` +
      `Recommended tier: ${tierLabel}\n` +
      `Recommended models: ${tierDef.recommendedModels.join(', ')}\n` +
      `Guidance: ${tierDef.guidance}`;

    return {
      tier,
      tierLabel,
      score,
      recommendedModels: tierDef.recommendedModels,
      source: 'description-heuristic',
      metrics,
      guidance: tierDef.guidance,
      reasoning,
      effortEstimate: this.estimateEffort(score, tierLabel),
    };
  }

  /**
   * Build human-readable reasoning for code-metric-based routing.
   */
  private buildCodeReasoning(
    score: number,
    tier: RoutingTier,
    tierLabel: string,
    tierDef: { recommendedModels: string[]; guidance: string },
    metrics: MetricResult[],
    description?: string,
    algorithm?: string,
  ): string {
    const parts: string[] = [];

    if (description) {
      parts.push(`Task: ${description}`);
    }

    const algoLabel = algorithm ? ` (algorithm: ${algorithm})` : '';
    parts.push(
      `Overall complexity: ${score}/100 → Tier ${tier} (${tierLabel})${algoLabel}`,
    );

    // Highlight the three core metrics
    const coreNames = ['cyclomatic', 'loc-impact', 'density'];
    const coreMetrics = metrics.filter(m => coreNames.includes(m.name));
    const secondaryMetrics = metrics.filter(m => !coreNames.includes(m.name));

    if (coreMetrics.length > 0) {
      parts.push('── Core routing metrics ──');
      for (const m of coreMetrics) {
        parts.push(`  ${m.name}: ${m.score}/100 — ${m.details.split('\n')[0]}`);
      }
    }

    if (secondaryMetrics.length > 0) {
      parts.push('── Secondary metrics ──');
      for (const m of secondaryMetrics) {
        parts.push(`  ${m.name}: ${m.score}/100`);
      }
    }

    parts.push(`Recommended tier: ${tierLabel}`);
    parts.push(`Recommended models: ${tierDef.recommendedModels.join(', ')}`);
    parts.push(`Guidance: ${tierDef.guidance}`);

    return parts.join('\n');
  }

  /**
   * Estimate effort level from score and tier.
   */
  private estimateEffort(
    score: number,
    _tierLabel: string,
  ): { level: string; description: string; suggestedTimeframe: string } {
    if (score <= 15) {
      return {
        level: 'trivial',
        description: 'Quick task — one or two prompts, minimal review needed.',
        suggestedTimeframe: 'minutes',
      };
    }
    if (score <= 40) {
      return {
        level: 'moderate',
        description: 'Several iterations, moderate review. Likely a few files.',
        suggestedTimeframe: 'under an hour',
      };
    }
    if (score <= 80) {
      return {
        level: 'complex',
        description: 'Substantial work across multiple files/modules. Needs thorough review.',
        suggestedTimeframe: 'a few hours to a day',
      };
    }
    return {
      level: 'expert',
      description: 'Major undertaking. May require deep architectural decisions and extensive review.',
      suggestedTimeframe: 'multiple days',
    };
  }

  /** Get the current config (useful for debugging / serialization) */
  getConfig(): RouterConfig {
    return { ...this.config };
  }

  /** Get the inner routing table */
  getRoutingTable(): RoutingTable {
    return this.routingTable;
  }
}
