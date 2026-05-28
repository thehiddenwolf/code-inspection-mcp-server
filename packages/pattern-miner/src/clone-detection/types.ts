/**
 * Types for the Semgrep structural clone detection module.
 */

/**
 * A single clone match result.
 */
export interface CloneMatch {
  /** Path to the file containing the clone */
  filePath: string;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed, inclusive) */
  endLine: number;
  /** Column of the match start */
  column?: number;
  /** Confidence score 0-1 (1.0 = exact structural match) */
  confidence: number;
  /** The matched code snippet */
  matchedCode: string;
  /** Structural similarity breakdown */
  similarity: {
    /** Fraction of nodes that matched structurally */
    structural: number;
    /** Whether identifiers are different (renamed) */
    renamed: boolean;
    /** Whether literals differ */
    literalDiffers: boolean;
  };
}

/**
 * Input to the clone finder tool.
 */
export interface FindClonesInput {
  /** The code fragment to find clones of */
  fragment: string;
  /** Programming language of the fragment */
  language: CloneLanguage;
  /** Codebase directory to search in */
  searchPath: string;
  /** Minimum confidence threshold (0-1, default 0.6) */
  minConfidence?: number;
  /** File extensions to include */
  extensions?: string[];
  /** Maximum number of results to return */
  maxResults?: number;
}

/**
 * Supported languages for clone detection.
 */
export type CloneLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'java' | 'jsx' | 'tsx';

/**
 * Result from a clone search.
 */
export interface CloneSearchResult {
  /** Input fragment that was searched */
  fragment: string;
  /** Language of the fragment */
  language: CloneLanguage;
  /** Search path used */
  searchPath: string;
  /** Number of files scanned */
  filesScanned: number;
  /** All clone matches found */
  matches: CloneMatch[];
  /** Total matches found before filtering/capping */
  totalMatches: number;
  /** Time taken in ms */
  durationMs: number;
}

/**
 * A Semgrep rule in JSON format for programmatic use.
 */
export interface SemgrepRule {
  id: string;
  pattern: string;
  language: string;
  message: string;
  severity: string;
}

/**
 * Semgrep CLI JSON output format.
 */
export interface SemgrepOutput {
  results: SemgrepResult[];
  errors: SemgrepError[];
  paths: { scanned: string[] };
}

export interface SemgrepResult {
  check_id: string;
  path: string;
  start: { line: number; col: number; offset: number };
  end: { line: number; col: number; offset: number };
  extra: {
    message: string;
    metavars: Record<string, { start: { offset: number }; end: { offset: number }; abstract_content: string }>;
    lines: string;
  };
}

export interface SemgrepError {
  type: string;
  message: string;
}
