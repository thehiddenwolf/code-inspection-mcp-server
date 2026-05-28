/**
 * MinHash implementation for fuzzy similarity estimation.
 *
 * MinHash approximates the Jaccard similarity between sets
 * by hashing each element (shingle) through k hash functions
 * and taking the minimum hash per function as the signature.
 *
 * Signature similarity ≈ Jaccard(original sets).
 *
 * LSH (Locality-Sensitive Hashing) partitions signatures into
 * bands so we can hash candidates into buckets for O(1) lookup
 * instead of O(n) pairwise comparison.
 */

import type { MinHashConfig, LshConfig, AstFingerprint, FingerprintMatch } from './types.js';
import { DEFAULT_MINHASH_CONFIG, DEFAULT_LSH_CONFIG } from './types.js';

/**
 * A set of random hash functions — each is (a * x + b) mod p.
 * We generate `numHashes` independent functions with random (a, b) pairs.
 */
function generateHashFunctions(numHashes: number): Array<{ a: number; b: number }> {
  const functions: Array<{ a: number; b: number }> = [];
  // Large prime for modulo — keeps hash values well-distributed
  const p = 2_147_483_647; // 2^31 - 1 (a Mersenne prime)
  const seen = new Set<string>();

  for (let i = 0; i < numHashes * 2; i++) {
    const a = 1 + Math.floor(Math.random() * (p - 1));
    const b = Math.floor(Math.random() * p);
    const key = `${a}:${b}`;
    if (!seen.has(key)) {
      seen.add(key);
      functions.push({ a, b });
    }
    if (functions.length === numHashes) break;
  }

  return functions;
}

/**
 * Compute a single hash: (a * x + b) mod p
 */
function hashFn(x: number, a: number, b: number): number {
  const p = 2_147_483_647;
  // Use BigInt to avoid overflow for large x
  return Number((BigInt(a) * BigInt(x) + BigInt(b)) % BigInt(p));
}

/**
 * Hash a string to a 32-bit integer (FNV-1a variant).
 * Deterministic and fast.
 */
function stringToHash(s: string): number {
  let hash = 2_166_136_261; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619); // FNV prime
    hash = hash >>> 0; // force unsigned 32-bit
  }
  return hash;
}

/**
 * Convert a text into a set of character n-grams (shingles).
 */
export function shingle(text: string, shingleSize: number): Set<string> {
  const shingles = new Set<string>();
  // Normalize whitespace to single spaces for matching robustness
  const normalized = text.replace(/\s+/g, ' ').trim();
  for (let i = 0; i <= normalized.length - shingleSize; i++) {
    shingles.add(normalized.slice(i, i + shingleSize));
  }
  return shingles;
}

/**
 * Compute the MinHash signature for a set of shingles.
 */
export function computeSignature(
  shingles: Set<string>,
  hashFunctions: Array<{ a: number; b: number }>,
): number[] {
  const signature: number[] = [];
  const shingleHashes = Array.from(shingles).map(s => stringToHash(s));

  for (const hf of hashFunctions) {
    let minHash = Infinity;
    for (const sh of shingleHashes) {
      const h = hashFn(sh, hf.a, hf.b);
      if (h < minHash) minHash = h;
    }
    signature.push(minHash === Infinity ? 0 : minHash);
  }

  return signature;
}

/**
 * Estimate Jaccard similarity between two MinHash signatures.
 * Returns a value in [0, 1].
 */
export function estimateSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / a.length;
}

/**
 * LSH index: maps band-hash → list of fingerprints for fast lookup.
 *
 * Each signature is split into `numBands` bands of `rowsPerBand` rows.
 * Each band is hashed independently. Two signatures that share a
 * band-hash are candidate pairs.
 */
export class LshIndex {
  private readonly numBands: number;
  private readonly rowsPerBand: number;
  private readonly bands: Map<string, AstFingerprint[]>;
  private hashFunctions: Array<{ a: number; b: number }>;

  constructor(config?: Partial<LshConfig & { hashFunctions: Array<{ a: number; b: number }> }>) {
    const merged = { ...DEFAULT_LSH_CONFIG, ...DEFAULT_MINHASH_CONFIG, ...config };
    this.numBands = merged.numBands;
    this.rowsPerBand = merged.rowsPerBand;
    this.bands = new Map();
    this.hashFunctions = config?.hashFunctions ?? generateHashFunctions(merged.signatureSize);
  }

  getHashFunctions(): Array<{ a: number; b: number }> {
    return this.hashFunctions;
  }

  /**
   * Insert a fingerprint into the LSH index.
   */
  insert(fp: AstFingerprint): void {
    const bands = this.splitSignature(fp.signature);
    for (const bandHash of bands) {
      const existing = this.bands.get(bandHash) ?? [];
      existing.push(fp);
      this.bands.set(bandHash, existing);
    }
  }

  /**
   * Query the LSH index for candidate matches to a fingerprint.
   * Returns candidate fingerprint matches (before similarity scoring).
   */
  query(fp: AstFingerprint): AstFingerprint[] {
    const candidates = new Map<string, AstFingerprint>();
    const bands = this.splitSignature(fp.signature);

    for (const bandHash of bands) {
      const bucket = this.bands.get(bandHash);
      if (!bucket) continue;
      for (const candidate of bucket) {
        // Don't match against ourselves
        if (candidate === fp) continue;
        const key = `${candidate.filePath}:${candidate.startLine}:${candidate.endLine}`;
        if (!candidates.has(key)) {
          candidates.set(key, candidate);
        }
      }
    }

    return Array.from(candidates.values());
  }

  /**
   * Run a full query: find candidates via LSH, then score with MinHash similarity.
   */
  search(queryFp: AstFingerprint, threshold: number = DEFAULT_LSH_CONFIG.threshold): FingerprintMatch[] {
    const candidates = this.query(queryFp);
    const results: FingerprintMatch[] = [];

    for (const candidate of candidates) {
      const similarity = estimateSimilarity(queryFp.signature, candidate.signature);
      if (similarity >= threshold) {
        results.push({
          queryLabel: queryFp.label,
          matchLabel: candidate.label,
          similarity,
          matchFilePath: candidate.filePath,
          matchStartLine: candidate.startLine,
          matchEndLine: candidate.endLine,
          renamed: queryFp.label !== candidate.label,
        });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);
    return results;
  }

  /**
   * Split a signature into band hashes.
   * Each band's rows are concatenated and hashed to produce a bucket key.
   */
  private splitSignature(signature: number[]): string[] {
    const bandHashes: string[] = [];
    for (let b = 0; b < this.numBands; b++) {
      const start = b * this.rowsPerBand;
      const end = Math.min(start + this.rowsPerBand, signature.length);
      if (start >= signature.length) break;
      const slice = signature.slice(start, end);
      // Hash the band's signature slice together
      const key = slice.join('|');
      bandHashes.push(key);
    }
    return bandHashes;
  }

  /**
   * Number of fingerprints indexed.
   */
  get size(): number {
    const unique = new Set<string>();
    const values = Array.from(this.bands.values());
    for (const fps of values) {
      for (const fp of fps) {
        unique.add(`${fp.filePath}:${fp.startLine}:${fp.endLine}`);
      }
    }
    return unique.size;
  }
}

/**
 * Create a set of hash functions given config.
 */
export function createHashFunctions(config: MinHashConfig = DEFAULT_MINHASH_CONFIG): Array<{ a: number; b: number }> {
  return generateHashFunctions(config.signatureSize);
}
