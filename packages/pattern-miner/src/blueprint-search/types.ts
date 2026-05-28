/**
 * Types for the unified blueprint search pipeline.
 *
 * Integrates Semgrep structural clone detection (AST-based)
 * with PMD CPD tokenized clone detection (Rabin-Karp rolling hash)
 * into a single, deduplicated search result.
 */

/**
 * Which engine(s) produced this finding.
 */
export type BlueprintMethod = 'semgrep' | 'cpd' | 'structural' | 'both' | 'all';

/**
 * A single unified finding from the blueprint search.
 */
export interface BlueprintFinding {
  /** Absolute file path */
  filePath: string;
  /** Start line (1-indexed) */
  startLine: number;
  /** End line (1-indexed, inclusive) */
  endLine: number;
  /** Column of the match start */
  column?: number;
  /** Confidence score 0–1 */
  confidence: number;
  /** Matched code snippet */
  snippet: string;
  /** Which engine(s) found this */
  method: BlueprintMethod;

  // ── Semgrep-specific metadata ──
  /** Structural similarity breakdown (Semgrep only) */
  similarity?: {
    structural: number;
    renamed: boolean;
    literalDiffers: boolean;
  };

  // ── CPD-specific metadata ──
  /** Number of matching tokens (CPD only) */
  tokenCount?: number;
  /** Path to the matched/cloned file (CPD cross-file pair) */
  matchedFilePath?: string;
  /** Line range in the matched file (CPD cross-file pair) */
  matchedLines?: string;
}

/**
 * Input to the unified blueprint search.
 */
export interface BlueprintSearchInput {
  /** Directory path to search in */
  searchPath: string;
  /** Optional code fragment for Semgrep structural search */
  fragment?: string;
  /** Programming language (required if fragment is provided) */
  language?: string;
  /** Minimum confidence threshold 0–1 (default: 0.6) */
  minConfidence?: number;
  /** Maximum results to return (default: 50) */
  maxResults?: number;
  /** File extensions to include */
  extensions?: string[];
  /** Directories to exclude */
  exclude?: string[];
  /** CPD minimum tile size in tokens (default: 30) */
  cpdMinimumTileSize?: number;
}

/**
 * Result from the unified blueprint search.
 */
export interface BlueprintSearchResult {
  /** Input fragment if provided */
  fragment?: string;
  /** Language if provided */
  language?: string;
  /** Search path used */
  searchPath: string;
  /** Number of files scanned */
  filesScanned: number;
  /** Total findings after deduplication */
  totalFindings: number;
  /** Number of findings from Semgrep (before dedup) */
  semgrepResults: number;
  /** Number of findings from CPD (before dedup) */
  cpdResults: number;
  /** Number of findings from AST fingerprinting (before dedup) */
  structuralResults: number;
  /** Number of findings found by both engines */
  bothResults: number;
  /** Deduplicated merged findings */
  findings: BlueprintFinding[];
  /** Time taken in ms */
  durationMs: number;
}
