/**
 * Blueprint Search Engine
 *
 * Unified search pipeline that integrates Semgrep structural clone detection
 * (AST-based, fragment-to-pattern) with PMD CPD tokenized clone detection
 * (Rabin-Karp rolling hash over normalized token streams).
 *
 * Merges results from both engines, deduplicating by (filePath, line range).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BlueprintFinding, BlueprintSearchInput, BlueprintSearchResult } from './types.js';
import { findClones } from '../clone-detection/semgrep-matcher.js';
import type { CloneLanguage } from '../clone-detection/types.js';
import { detectClones } from '../patterns/duplication/cpd-clones.js';
import type { CpdOptions } from '../patterns/duplication/cpd-clones.js';
import { AstFingerprintEngine } from './ast-fingerprinting/engine.js';

// ── Deduplication ───────────────────────────────────────────────────────────

/**
 * Build a dedup key from file path and line range.
 * Overlapping ranges with the same file are considered the same finding.
 */
function dedupKey(filePath: string, startLine: number, endLine: number): string {
  // Truncate to 10-line buckets for fuzzy overlap merging
  const bucket = Math.floor(startLine / 10);
  return `${filePath}:${bucket}`;
}

/**
 * Check if two line ranges overlap.
 */
function rangesOverlap(s1: number, e1: number, s2: number, e2: number): boolean {
  return s1 <= e2 && s2 <= e1;
}

/**
 * Merge a new finding into a dedup map, combining methods if overlapping.
 */
function mergeFinding(
  map: Map<string, BlueprintFinding>,
  finding: BlueprintFinding,
): void {
  const key = dedupKey(finding.filePath, finding.startLine, finding.endLine);

  const existing = map.get(key);
  if (!existing) {
    map.set(key, finding);
    return;
  }

  // Check for actual overlap
  if (!rangesOverlap(existing.startLine, existing.endLine, finding.startLine, finding.endLine)) {
    // Same bucket but different sections — keep both
    // Use a sub-key
    const subKey = `${key}:${finding.startLine}`;
    map.set(subKey, finding);
    return;
  }

  // Merge — widen the range and upgrade method
  existing.startLine = Math.min(existing.startLine, finding.startLine);
  existing.endLine = Math.max(existing.endLine, finding.endLine);
  existing.confidence = Math.max(existing.confidence, finding.confidence);

  if (existing.method !== finding.method) {
    existing.method = 'both';
  }

  // Merge Semgrep metadata
  if (finding.similarity && !existing.similarity) {
    existing.similarity = finding.similarity;
  }

  // Merge CPD metadata
  if (finding.tokenCount && (!existing.tokenCount || finding.tokenCount > existing.tokenCount)) {
    existing.tokenCount = finding.tokenCount;
    existing.matchedFilePath = finding.matchedFilePath;
    existing.matchedLines = finding.matchedLines;
  }

  // Prefer the longer snippet
  if (finding.snippet.length > existing.snippet.length) {
    existing.snippet = finding.snippet;
  }
}

// ── File walking ────────────────────────────────────────────────────────────

function walkFiles(
  directory: string,
  extensions: string[],
  exclude: string[],
): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!exclude.includes(entry.name)) {
          results.push(...walkFiles(fullPath, extensions, exclude));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Permission denied, etc. — skip
  }
  return results;
}

// ── CPD adapter ─────────────────────────────────────────────────────────────

/**
 * Convert CPD ClonePair results into BlueprintFinding[].
 * Each clone pair produces two findings (one for each file).
 */
function cpdResultsToFindings(
  filePaths: string[],
  searchPath: string,
  minConfidence: number,
): BlueprintFinding[] {
  const findings: BlueprintFinding[] = [];

  // Read all files for CPD analysis
  const files = filePaths
    .map(fp => {
      try {
        return { path: fp, content: fs.readFileSync(fp, 'utf-8') };
      } catch {
        return null;
      }
    })
    .filter((f): f is { path: string; content: string } => f !== null);

  if (files.length < 2) return findings;

  const clones = detectClones(files);

  for (const clone of clones) {
    // Compute a pseudo-confidence from token ratio
    // More tokens = higher confidence it's a real clone
    const maxTokens = 500; // cap for normalization
    const confidence = Math.min(0.5 + (clone.tokenCount / maxTokens) * 0.5, 1.0);

    if (confidence < minConfidence) continue;

    const snippetA = files.find(f => f.path === clone.fileA)?.content
      ?.split('\n')
      .slice(clone.startLineA - 1, clone.startLineA + 2)
      .join('\n')
      .substring(0, 200) || clone.snippet;

    findings.push({
      filePath: clone.fileA,
      startLine: clone.startLineA,
      endLine: clone.endLineA,
      confidence,
      snippet: snippetA,
      method: 'cpd',
      tokenCount: clone.tokenCount,
      matchedFilePath: clone.fileB,
      matchedLines: `${clone.startLineB}-${clone.endLineB}`,
    });

    const snippetB = files.find(f => f.path === clone.fileB)?.content
      ?.split('\n')
      .slice(clone.startLineB - 1, clone.startLineB + 2)
      .join('\n')
      .substring(0, 200) || clone.snippet;

    findings.push({
      filePath: clone.fileB,
      startLine: clone.startLineB,
      endLine: clone.endLineB,
      confidence,
      snippet: snippetB,
      method: 'cpd',
      tokenCount: clone.tokenCount,
      matchedFilePath: clone.fileA,
      matchedLines: `${clone.startLineA}-${clone.endLineA}`,
    });
  }

  return findings;
}

// ── Structural (AST Fingerprinting) adapter ──────────────────────────────────

/**
 * Convert AST fingerprinting matches into BlueprintFinding[].
 * Uses the AstFingerprintEngine to find structural clones across files.
 */
function structuralResultsToFindings(
  filePaths: string[],
  minConfidence: number,
): BlueprintFinding[] {
  const findings: BlueprintFinding[] = [];

  // Read all files
  const files = filePaths
    .map(fp => {
      try {
        return { path: fp, content: fs.readFileSync(fp, 'utf-8') };
      } catch {
        return null;
      }
    })
    .filter((f): f is { path: string; content: string } => f !== null);

  if (files.length < 2) return findings;

  try {
    const engine = new AstFingerprintEngine({
      lsh: { threshold: minConfidence },
    });

    engine.indexFiles(files);
    const matches = engine.findAllCrossFileClones(minConfidence);

    for (const match of matches) {
      findings.push({
        filePath: match.matchFilePath,
        startLine: match.matchStartLine,
        endLine: match.matchEndLine,
        confidence: match.similarity,
        snippet: `Structurally similar to "${match.queryLabel}"`,
        method: 'structural',
        matchedFilePath: match.queryLabel,
        matchedLines: `${match.matchStartLine}-${match.matchEndLine}`,
      });
    }
  } catch (err) {
    console.error(`[blueprint-search] Structural fingerprinting error: ${err}`);
    // Non-fatal
  }

  return findings;
}

// ── Unified Search ──────────────────────────────────────────────────────────

/**
 * Run a unified blueprint search using both Semgrep (if fragment provided)
 * and PMD CPD, then merge and deduplicate results.
 */
export async function blueprintSearch(
  input: BlueprintSearchInput,
): Promise<BlueprintSearchResult> {
  const startTime = Date.now();

  const {
    searchPath,
    fragment,
    language,
    minConfidence = 0.6,
    maxResults = 50,
    extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py'],
    exclude = ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.venv', '__pycache__'],
    cpdMinimumTileSize = 30,
  } = input;

  if (!fs.existsSync(searchPath)) {
    throw new Error(`Search path does not exist: ${searchPath}`);
  }

  // ── Phase 1: Collect files ──
  const filePaths = walkFiles(searchPath, extensions, exclude);

  // ── Phase 2: Run Semgrep (if fragment provided) ──
  let semgrepFindings: BlueprintFinding[] = [];
  let semgrepResults = 0;

  if (fragment && language) {
    try {
      const semgrepResult = await findClones(
        fragment,
        language as CloneLanguage,
        searchPath,
        { minConfidence, maxResults: Math.max(maxResults, 100) },
      );

      semgrepResults = semgrepResult.matches.length;

      semgrepFindings = semgrepResult.matches.map(m => ({
        filePath: m.filePath,
        startLine: m.startLine,
        endLine: m.endLine,
        column: m.column,
        confidence: m.confidence,
        snippet: m.matchedCode,
        method: 'semgrep' as const,
        similarity: m.similarity,
      }));
    } catch (err) {
      console.error(`[blueprint-search] Semgrep error: ${err}`);
      // Non-fatal — continue with CPD only
    }
  }

  // ── Phase 3: Run CPD ──
  let cpdFindings: BlueprintFinding[] = [];
  let cpdResults = 0;

  if (filePaths.length >= 2) {
    try {
      cpdFindings = cpdResultsToFindings(filePaths, searchPath, minConfidence);
      cpdResults = cpdFindings.length;
    } catch (err) {
      console.error(`[blueprint-search] CPD error: ${err}`);
      // Non-fatal
    }
  }

  // ── Phase 4: Run AST Fingerprinting (structural) ──
  let structuralFindings: BlueprintFinding[] = [];
  let structuralResults = 0;

  if (filePaths.length >= 2) {
    try {
      structuralFindings = structuralResultsToFindings(filePaths, minConfidence);
      structuralResults = structuralFindings.length;
    } catch (err) {
      console.error(`[blueprint-search] Structural fingerprinting error: ${err}`);
      // Non-fatal
    }
  }

  // ── Phase 5: Merge and deduplicate ──
  const dedupMap = new Map<string, BlueprintFinding>();

  for (const finding of semgrepFindings) {
    mergeFinding(dedupMap, finding);
  }
  for (const finding of cpdFindings) {
    mergeFinding(dedupMap, finding);
  }
  for (const finding of structuralFindings) {
    mergeFinding(dedupMap, finding);
  }

  const mergedFindings = Array.from(dedupMap.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxResults);

  const bothResults = mergedFindings.filter(f => f.method === 'both').length;

  return {
    fragment,
    language,
    searchPath,
    filesScanned: filePaths.length,
    totalFindings: mergedFindings.length,
    semgrepResults,
    cpdResults,
    structuralResults,
    bothResults,
    findings: mergedFindings,
    durationMs: Date.now() - startTime,
  };
}
