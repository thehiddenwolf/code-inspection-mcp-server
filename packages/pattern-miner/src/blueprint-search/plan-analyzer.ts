/**
 * blueprint_scout_analyze_plan — MCP tool for plan analysis.
 *
 * Takes a structured implementation plan and cross-references
 * each step against the codebase, reporting duplication risk.
 *
 * TOOL_SPECS §2.4:
 * "Takes a step-by-step implementation plan (markdown or structured JSON)
 *  and cross-references each step against the codebase."
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { blueprintSearch } from './engine.js';
import type { BlueprintSearchInput, BlueprintSearchResult } from './types.js';

/**
 * A single step in an implementation plan.
 */
export interface PlanStep {
  action: string;
  target_files?: string[];
  functions_to_create?: string[];
  key_terms?: string[];
}

/**
 * Structured implementation plan.
 */
export interface ImplementationPlan {
  title: string;
  steps: PlanStep[];
}

/**
 * Analysis result for a single plan step.
 */
export interface StepAnalysis {
  step_index: number;
  action: string;
  duplication_risk: 'high' | 'medium' | 'low' | 'none';
  blocking_matches: Array<{
    filePath: string;
    similarity: number;
    matchType: string;
    snippet: string;
    reason: string;
  }>;
  suggested_action: 'proceed' | 'reuse_existing' | 'refactor_plan';
}

/**
 * Complete plan analysis result.
 */
export interface PlanAnalysisResult {
  plan_steps: StepAnalysis[];
  overall_duplication_risk: 'high' | 'medium' | 'low';
  interrupt: boolean;
  durationMs: number;
}

/**
 * Analyze an implementation plan against the codebase.
 *
 * For each step, extracts key terms and function names, then
 * runs blueprint search to find existing code that may already
 * implement what this step proposes.
 */
export async function analyzePlan(
  plan: ImplementationPlan,
  codebasePath: string = '.',
): Promise<PlanAnalysisResult> {
  const startTime = Date.now();
  const resolvePath = path.resolve(codebasePath);

  if (!fs.existsSync(resolvePath)) {
    throw new Error(`Codebase path does not exist: ${resolvePath}`);
  }

  const stepAnalyses: StepAnalysis[] = [];
  let highRiskCount = 0;
  let mediumRiskCount = 0;

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];

    // Build a search query from the step's key terms and function names
    const searchTerms = [
      ...(step.key_terms ?? []),
      ...(step.functions_to_create ?? []),
      step.action,
    ].filter(Boolean);
    const query = searchTerms.join(' ');

    // Search the codebase for existing code related to this step
    let searchResult: BlueprintSearchResult;
    try {
      searchResult = await blueprintSearch({
        fragment: query,
        language: detectLanguage(resolvePath),
        searchPath: resolvePath,
        minConfidence: 0.3,
        maxResults: 5,
      });
    } catch {
      // If search fails (e.g., no semgrep), return empty results
      searchResult = {
        findings: [],
        filesScanned: 0,
        totalFindings: 0,
        semgrepResults: 0,
        cpdResults: 0,
        bothResults: 0,
        durationMs: 0,
        searchPath: resolvePath,
      } as unknown as BlueprintSearchResult;
    }

    // Evaluate duplication risk based on findings
    const findings = searchResult.findings ?? [];
    const sortedFindings = [...findings].sort((a, b) => b.confidence - a.confidence);

    // Determine risk level
    const highestConfidence = sortedFindings.length > 0 ? sortedFindings[0].confidence : 0;
    const highConfidenceCount = sortedFindings.filter(f => f.confidence >= 0.8).length;
    const mediumConfidenceCount = sortedFindings.filter(
      f => f.confidence >= 0.5 && f.confidence < 0.8,
    ).length;

    let duplication_risk: 'high' | 'medium' | 'low' | 'none';
    let suggested_action: 'proceed' | 'reuse_existing' | 'refactor_plan';

    if (highConfidenceCount >= 2 || highestConfidence >= 0.9) {
      duplication_risk = 'high';
      suggested_action = 'reuse_existing';
      highRiskCount++;
    } else if (highConfidenceCount >= 1 || mediumConfidenceCount >= 2) {
      duplication_risk = 'medium';
      suggested_action = 'refactor_plan';
      mediumRiskCount++;
    } else if (mediumConfidenceCount >= 1) {
      duplication_risk = 'low';
      suggested_action = 'proceed';
    } else {
      duplication_risk = 'none';
      suggested_action = 'proceed';
    }

    stepAnalyses.push({
      step_index: i,
      action: step.action,
      duplication_risk,
      blocking_matches: sortedFindings.slice(0, 3).map(f => ({
        filePath: f.filePath,
        similarity: f.confidence,
        matchType: f.method === 'both' ? 'structural_clone' : f.method === 'semgrep' ? 'pattern_match' : 'exact_clone',
        snippet: (f as any).snippet ?? '',
        reason: `${f.method === 'semgrep' ? 'Structural match' : 'Token-based duplicate'} (${(f.confidence * 100).toFixed(0)}% confidence)`,
      })),
      suggested_action,
    });
  }

  // Overall risk assessment
  let overall_duplication_risk: 'high' | 'medium' | 'low';
  if (highRiskCount >= plan.steps.length / 2) {
    overall_duplication_risk = 'high';
  } else if (highRiskCount > 0 || mediumRiskCount >= plan.steps.length / 3) {
    overall_duplication_risk = 'medium';
  } else {
    overall_duplication_risk = 'low';
  }

  return {
    plan_steps: stepAnalyses,
    overall_duplication_risk,
    interrupt: overall_duplication_risk === 'high',
    durationMs: Date.now() - startTime,
  };
}

/**
 * Detect the primary language in a codebase.
 */
function detectLanguage(rootPath: string): string {
  // Check for common indicators
  const packageJson = path.join(rootPath, 'package.json');
  const pyProject = path.join(rootPath, 'pyproject.toml');
  const requirements = path.join(rootPath, 'requirements.txt');
  const goMod = path.join(rootPath, 'go.mod');
  const cargo = path.join(rootPath, 'Cargo.toml');

  if (fs.existsSync(packageJson)) return 'typescript';
  if (fs.existsSync(pyProject) || fs.existsSync(requirements)) return 'python';
  if (fs.existsSync(goMod)) return 'go';
  if (fs.existsSync(cargo)) return 'rust';

  // Count file extensions
  let tsCount = 0;
  let pyCount = 0;
  let jsCount = 0;

  try {
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.ts' || ext === '.tsx') tsCount++;
        else if (ext === '.py') pyCount++;
        else if (ext === '.js' || ext === '.jsx') jsCount++;
      }
    }
  } catch {
    // Ignore read errors
  }

  if (tsCount > 0) return 'typescript';
  if (pyCount > 0) return 'python';
  if (jsCount > 0) return 'javascript';
  return 'typescript';
}
