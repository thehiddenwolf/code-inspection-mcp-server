/**
 * AST fingerprinting engine — engine #3 for Blueprint Scout.
 *
 * Extracts structural skeletons from source code, computes MinHash
 * signatures, and provides an LSH index for fast fuzzy matching.
 *
 * This detects structural clones (Type-2 clones — renamed variables,
 * changed literals, same shape) that Semgrep and CPD may miss.
 *
 * Usage:
 *   const engine = new AstFingerprintEngine();
 *   await engine.indexCodebase('/path/to/codebase');
 *   const matches = await engine.search('function add(a, b) { return a + b; }');
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { shingle, computeSignature, LshIndex, estimateSimilarity, createHashFunctions } from './minhash.js';
import { fingerprintFile, isMeaningfulSkeleton } from './skeleton-extractor.js';
import type { AstFingerprint, FingerprintMatch, MinHashConfig, LshConfig } from './types.js';
import { DEFAULT_MINHASH_CONFIG, DEFAULT_LSH_CONFIG } from './types.js';

export interface AstFingerprintEngineConfig {
  minhash?: Partial<MinHashConfig>;
  lsh?: Partial<LshConfig>;
}

/**
 * Results from a fingerprint search.
 */
export interface FingerprintSearchResult {
  queryFingerprint: AstFingerprint;
  matches: FingerprintMatch[];
  totalIndexed: number;
  durationMs: number;
}

/**
 * Results from indexing a codebase.
 */
export interface IndexResult {
  filesScanned: number;
  fingerprintsGenerated: number;
  fingerprintsIndexed: number;
  durationMs: number;
  errors: string[];
}

export class AstFingerprintEngine {
  private lshIndex: LshIndex;
  private config: { minhash: MinHashConfig; lsh: LshConfig };
  /** All fingerprints currently indexed, keyed by unique ID */
  private indexedFingerprints: Map<string, AstFingerprint> = new Map();
  /** File hash → last modified time for cache invalidation */
  private fileCache: Map<string, number> = new Map();

  constructor(config?: AstFingerprintEngineConfig) {
    this.config = {
      minhash: { ...DEFAULT_MINHASH_CONFIG, ...config?.minhash },
      lsh: { ...DEFAULT_LSH_CONFIG, ...config?.lsh },
    };

    // Pre-create hash functions
    const hashFns = createHashFunctions(this.config.minhash);

    this.lshIndex = new LshIndex({
      ...this.config.lsh,
      hashFunctions: hashFns,
    });
  }

  /**
   * Index an entire codebase.
   * Recursively scans for TypeScript, JavaScript, and Python files.
   */
  async indexCodebase(
    rootPath: string,
    options?: {
      extensions?: string[];
      exclude?: string[];
    },
  ): Promise<IndexResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let filesScanned = 0;

    const resolvePath = path.resolve(rootPath);
    if (!fs.existsSync(resolvePath)) {
      throw new Error(`Directory does not exist: ${resolvePath}`);
    }

    const extensions = options?.extensions ?? ['.ts', '.tsx', '.js', '.jsx', '.py'];
    const excludePatterns = options?.exclude ?? [
      'node_modules', 'dist', '.git', '__pycache__',
      'venv', '.venv', 'coverage', '.next',
    ];

    const files = this.walkFiles(resolvePath, extensions, excludePatterns);

    for (const filePath of files) {
      try {
        const stat = fs.statSync(filePath);
        const cachedMtime = this.fileCache.get(filePath);

        // Skip if file hasn't changed since last index
        if (cachedMtime !== undefined && stat.mtimeMs <= cachedMtime) {
          filesScanned++;
          continue;
        }

        const code = fs.readFileSync(filePath, 'utf-8');
        const fingerprints = fingerprintFile(code, filePath);

        // Compute signatures and index meaningful ones
        for (const fp of fingerprints) {
          if (!isMeaningfulSkeleton(fp.skeleton)) continue;

          const shingles = shingle(fp.skeleton, this.config.minhash.shingleSize);
          fp.shingleCount = shingles.size;
          fp.signature = computeSignature(shingles, this.lshIndex.getHashFunctions());

          const key = `${fp.filePath}:${fp.startLine}:${fp.endLine}`;
          this.indexedFingerprints.set(key, fp);
          this.lshIndex.insert(fp);
        }

        this.fileCache.set(filePath, stat.mtimeMs);
        filesScanned++;
      } catch (err) {
        errors.push(`${filePath}: ${(err as Error).message}`);
      }
    }

    return {
      filesScanned,
      fingerprintsGenerated: this.indexedFingerprints.size,
      fingerprintsIndexed: this.lshIndex.size,
      durationMs: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Search for structural clones of a code snippet.
   *
   * @param code — Source code snippet to search for
   * @param filePath — Optional source file path for context
   */
  async search(
    code: string,
    filePath: string = '<query>',
    threshold?: number,
  ): Promise<FingerprintSearchResult> {
    const startTime = Date.now();

    // Create a fingerprint from the query code
    const queryFps = fingerprintFile(code, filePath);
    if (queryFps.length === 0) {
      return {
        queryFingerprint: {
          label: '<query>',
          skeleton: code,
          signature: [],
          shingleCount: 0,
          filePath,
          startLine: 1,
          endLine: code.split('\n').length,
          kind: 'function',
        },
        matches: [],
        totalIndexed: this.lshIndex.size,
        durationMs: Date.now() - startTime,
      };
    }

    // Use the first meaningful fragment as query
    const queryFp = queryFps[0];

    // Compute signature for query
    const shingles = shingle(queryFp.skeleton, this.config.minhash.shingleSize);
    queryFp.shingleCount = shingles.size;
    queryFp.signature = computeSignature(shingles, this.lshIndex.getHashFunctions());

    const effectiveThreshold = threshold ?? this.config.lsh.threshold;
    const matches = this.lshIndex.search(queryFp, effectiveThreshold);

    return {
      queryFingerprint: queryFp,
      matches,
      totalIndexed: this.lshIndex.size,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Compare two code snippets directly (without indexing).
   * Returns their structural similarity.
   */
  compareDirect(a: string, b: string): number {
    const fpA = fingerprintFile(a, '<a>');
    const fpB = fingerprintFile(b, '<b>');

    if (fpA.length === 0 || fpB.length === 0) return 0;

    const skeletonA = fpA[0].skeleton;
    const skeletonB = fpB[0].skeleton;

    const shinglesA = shingle(skeletonA, this.config.minhash.shingleSize);
    const shinglesB = shingle(skeletonB, this.config.minhash.shingleSize);

    const sigA = computeSignature(shinglesA, this.lshIndex.getHashFunctions());
    const sigB = computeSignature(shinglesB, this.lshIndex.getHashFunctions());

    return estimateSimilarity(sigA, sigB);
  }

  /**
   * Get total count of indexed fingerprints.
   */
  get indexedCount(): number {
    return this.lshIndex.size;
  }

  /**
   * Walk a directory recursively, collecting files matching extensions.
   */
  private walkFiles(
    dir: string,
    extensions: string[],
    exclude: string[],
  ): string[] {
    const results: string[] = [];

    const shouldExclude = (name: string): boolean =>
      exclude.some(pattern =>
        name === pattern || name.startsWith(pattern + '/') || name.includes('/' + pattern + '/'),
      );

    const walk = (currentDir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (shouldExclude(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            results.push(fullPath);
          }
        }
      }
    };

    walk(dir);
    return results;
  }

  /**
   * Index files directly from file objects (path + content).
   * Unlike indexCodebase which walks the filesystem, this accepts
   * pre-loaded file content for use in catalog detectors.
   */
  indexFiles(files: Array<{ path: string; content: string }>): IndexResult {
    const startTime = Date.now();
    const errors: string[] = [];
    let filesScanned = 0;

    for (const file of files) {
      try {
        const fingerprints = fingerprintFile(file.content, file.path);

        for (const fp of fingerprints) {
          if (!isMeaningfulSkeleton(fp.skeleton)) continue;

          const shingles = shingle(fp.skeleton, this.config.minhash.shingleSize);
          fp.shingleCount = shingles.size;
          fp.signature = computeSignature(shingles, this.lshIndex.getHashFunctions());

          const key = `${fp.filePath}:${fp.startLine}:${fp.endLine}`;
          this.indexedFingerprints.set(key, fp);
          this.lshIndex.insert(fp);
        }

        this.fileCache.set(file.path, Date.now());
        filesScanned++;
      } catch (err) {
        errors.push(`${file.path}: ${(err as Error).message}`);
      }
    }

    return {
      filesScanned,
      fingerprintsGenerated: this.indexedFingerprints.size,
      fingerprintsIndexed: this.lshIndex.size,
      durationMs: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Find all cross-file structural clone pairs in the indexed fingerprints.
   * Each indexed fingerprint is used as a query against the LSH index,
   * and cross-file matches above the threshold are returned.
   */
  findAllCrossFileClones(threshold?: number): FingerprintMatch[] {
    const effectiveThreshold = threshold ?? this.config.lsh.threshold;
    const seen = new Set<string>();
    const allMatches: FingerprintMatch[] = [];

    for (const [key, fp] of this.indexedFingerprints) {
      // Use the full search pipeline (LSH candidates + similarity scoring)
      const candidates = this.lshIndex.query(fp);

      for (const candidate of candidates) {
        // Skip self-matches (same file + same line range)
        const candidateKey = `${candidate.filePath}:${candidate.startLine}:${candidate.endLine}`;
        if (candidateKey === key) continue;

        // Skip same-file matches (internal duplication — handled by other detectors)
        if (candidate.filePath === fp.filePath) continue;

        // Deduplicate: store pair as sorted tuple
        const pairKey = [key, candidateKey].sort().join('|||');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const similarity = estimateSimilarity(fp.signature, candidate.signature);
        if (similarity >= effectiveThreshold) {
          allMatches.push({
            queryLabel: fp.label,
            matchLabel: candidate.label,
            similarity,
            matchFilePath: candidate.filePath,
            matchStartLine: candidate.startLine,
            matchEndLine: candidate.endLine,
            renamed: fp.label !== candidate.label,
          });
        }
      }
    }

    // Sort by similarity descending
    allMatches.sort((a, b) => b.similarity - a.similarity);
    return allMatches;
  }

  /**
   * Clear all indexed fingerprints.
   */
  clear(): void {
    this.indexedFingerprints.clear();
    this.fileCache.clear();
    const hashFns = createHashFunctions(this.config.minhash);
    this.lshIndex = new LshIndex({
      ...this.config.lsh,
      hashFunctions: hashFns,
    });
  }
}
