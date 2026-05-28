/**
 * Types for AST fingerprinting with MinHash/LSH.
 *
 * Implements engine #3 from Blueprint Scout spec §2.2:
 * "AST fingerprinting — Custom hash-based signature matching
 *  for function/class skeletons, compared via MinHash/LSH
 *  for fuzzy similarity."
 */

/**
 * A single fingerprint extracted from a function or class skeleton.
 */
export interface AstFingerprint {
  /** Human-readable label (e.g., function name, class name) */
  label: string;
  /** AST skeleton text — structural form with names/literals stripped */
  skeleton: string;
  /** MinHash signature as an array of integer hashes */
  signature: number[];
  /** Shingle set size used for MinHash (for debugging) */
  shingleCount: number;
  /** Source file path */
  filePath: string;
  /** Start line in source (1-indexed) */
  startLine: number;
  /** End line in source (1-indexed, inclusive) */
  endLine: number;
  /** Kind of skeleton: function, class, method, lambda */
  kind: SkeletonKind;
}

export type SkeletonKind = 'function' | 'class' | 'method' | 'lambda';

/**
 * Result of a fuzzy fingerprint search.
 */
export interface FingerprintMatch {
  /** The query fingerprint label */
  queryLabel: string;
  /** The matching fingerprint from the index */
  matchLabel: string;
  /** Jaccard similarity estimate from MinHash signatures */
  similarity: number;
  /** Source file path of the match */
  matchFilePath: string;
  /** Line range in the match file */
  matchStartLine: number;
  matchEndLine: number;
  /** Whether labels differ (renamed clone) */
  renamed: boolean;
}

/**
 * Configuration for MinHash.
 */
export interface MinHashConfig {
  /** Number of hash functions / signature size (default: 128) */
  signatureSize: number;
  /** Shingle size in characters (default: 5) */
  shingleSize: number;
}

/**
 * Index structure for LSH (Locality-Sensitive Hashing).
 * Partitions signatures into bands for fast approximate search.
 */
export interface LshConfig {
  /** Number of bands (partitions) — default: 16 */
  numBands: number;
  /** Rows per band (signatureSize / numBands) */
  rowsPerBand: number;
  /** Similarity threshold above which a candidate is returned */
  threshold: number;
}

export const DEFAULT_MINHASH_CONFIG: MinHashConfig = {
  signatureSize: 128,
  shingleSize: 5,
};

export const DEFAULT_LSH_CONFIG: LshConfig = {
  numBands: 16,
  rowsPerBand: 8,
  threshold: 0.5,
};
