/**
 * Clone scanner — orchestrator that walks files and runs Semgrep matching.
 * Integrates with the existing pattern-miner scan pipeline.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PatternMatchType } from '@hermes/shared/schemas/patterns.js';
import type { Finding, ScanReport } from '../types.js';
import { findClones } from './semgrep-matcher.js';
import type { CloneLanguage, CloneMatch, CloneSearchResult, FindClonesInput } from './types.js';

/**
 * Run clone detection against a codebase.
 */
export async function runCloneDetection(input: FindClonesInput): Promise<CloneSearchResult> {
  const result = await findClones(
    input.fragment,
    input.language,
    input.searchPath,
    {
      minConfidence: input.minConfidence ?? 0.6,
      maxResults: input.maxResults ?? 20,
    },
  );
  return result;
}

/**
 * Convert clone matches to the standard Finding format used by the
 * pattern-miner scan pipeline.
 */
export function cloneMatchesToFindings(
  matches: CloneMatch[],
  patternId: string,
  patternName: string,
): PatternMatchType[] {
  return matches.map(m => ({
    pattern_id: patternId,
    pattern_name: patternName,
    file_path: m.filePath,
    line: m.startLine,
    end_line: m.endLine,
    column: m.column,
    message: `Structural clone detected (confidence: ${(m.confidence * 100).toFixed(0)}%)${m.similarity.renamed ? ' — renamed identifiers' : ''}${m.similarity.literalDiffers ? ' — different literals' : ''}`,
    severity: m.confidence >= 0.9 ? ('warning' as const) : ('info' as const),
    category: 'duplication' as const,
    snippet: m.matchedCode,
  }));
}

/**
 * Batch clone detection: search for structural clones of multiple fragments
 * across a codebase, and produce a merged scan report.
 */
export async function batchCloneSearch(
  fragments: { fragment: string; language: CloneLanguage }[],
  searchPath: string,
  options?: { minConfidence?: number; maxResultsPerFragment?: number },
): Promise<ScanReport> {
  const startTime = Date.now();
  const scanId = `clone_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const allFindings: Finding[] = [];

  for (const { fragment, language } of fragments) {
    try {
      const result = await findClones(fragment, language, searchPath, {
        minConfidence: options?.minConfidence ?? 0.6,
        maxResults: options?.maxResultsPerFragment ?? 10,
      });

      const findings = cloneMatchesToFindings(result.matches, 'structural-clone', 'Structural Clone');
      allFindings.push(...(findings as unknown as Finding[]));
    } catch (err) {
      console.error(`[clone-detection] Error processing fragment: ${err}`);
    }
  }

  // Deduplicate by file+line
  const seen = new Set<string>();
  const uniqueFindings = allFindings.filter(f => {
    const key = `${f.filePath}:${f.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Aggregate by severity
  const findingsBySeverity: Record<string, number> = {};
  for (const f of uniqueFindings) {
    findingsBySeverity[f.severity] = (findingsBySeverity[f.severity] || 0) + 1;
  }

  return {
    scanId,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    filesScanned: 0, // Semgrep tracks this internally
    totalFindings: uniqueFindings.length,
    findingsBySeverity,
    findings: uniqueFindings,
  };
}
