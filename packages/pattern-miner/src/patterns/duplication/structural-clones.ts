/**
 * Structural Code Clone Detection (AST Fingerprinting)
 *
 * Implements Type-2 structural clone detection using AST skeleton extraction
 * and MinHash/LSH fingerprinting. Detects cross-file clones with renamed
 * identifiers and changed literals — the same structural shape but different
 * names/values.
 *
 * This is engine #3 in the Blueprint Scout pipeline, complementing:
 *   - Semgrep (Type-3/Type-1): semantic patterns + exact matches
 *   - PMD CPD (Type-1/Type-2): token-level normalized clones
 *   - AST fingerprinting (Type-2): structural skeleton matches
 *
 * References:
 *   - https://en.wikipedia.org/wiki/MinHash
 *   - https://en.wikipedia.org/wiki/Locality-sensitive_hashing
 */

import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';
import { AstFingerprintEngine } from '../../blueprint-search/ast-fingerprinting/engine.js';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface StructuralCloneOptions {
  /** Minimum similarity threshold (0–1). Default: 0.5 */
  minSimilarity?: number;
  /** Max files to process in a single batch (0 = unlimited). Default: 0 */
  maxFiles?: number;
}

const DEFAULT_OPTIONS: Required<StructuralCloneOptions> = {
  minSimilarity: 0.5,
  maxFiles: 0,
};

// ── Adapter for pattern-miner catalog ─────────────────────────────────────────

/**
 * Detect structural code clones across a set of files using AST fingerprinting.
 *
 * Uses MinHash/LSH to compare structural skeletons (function/class shapes
 * with names and literals stripped). Returns PatternMatchType[] for
 * integration with the pattern-miner scanner.
 *
 * @param files - Array of file descriptors with path and content
 * @param options - Optional configuration overrides
 * @returns Array of structural clone findings
 */
export async function detectStructuralClones(
  files: { path: string; content: string }[],
  options?: StructuralCloneOptions,
): Promise<PatternMatchType[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const findings: PatternMatchType[] = [];

  // Trivial case: need at least 2 files to detect cross-file clones
  if (files.length < 2) return findings;

  // Apply file limit if configured
  const filesToProcess = opts.maxFiles > 0 ? files.slice(0, opts.maxFiles) : files;

  // Create engine with appropriate similarity threshold
  const engine = new AstFingerprintEngine({
    lsh: { threshold: opts.minSimilarity },
  });

  // Index all files
  engine.indexFiles(filesToProcess);

  // Find all cross-file structural clone pairs
  const matches = engine.findAllCrossFileClones(opts.minSimilarity);

  // Convert matches to PatternMatchType[]
  for (const match of matches) {
    findings.push({
      pattern_id: 'structural-clones',
      pattern_name: 'Structural Code Clone (AST Fingerprint)',
      file_path: match.matchFilePath,
      line: match.matchStartLine,
      end_line: match.matchEndLine,
      message: `Structural clone of "${match.queryLabel}" (similarity: ${(match.similarity * 100).toFixed(0)}%)`,
      severity: 'warning' as PatternSeverityType,
      category: 'duplication' as PatternCategoryType,
      snippet: `Structurally similar to "${match.queryLabel}" — ${match.renamed ? 'renamed identifiers' : 'same labels'}`,
    });
  }

  return findings;
}
