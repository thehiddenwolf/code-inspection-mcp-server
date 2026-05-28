/**
 * Semgrep structural matcher for code clone detection.
 *
 * Takes a code fragment, converts it to a structural Semgrep pattern
 * (replacing identifiers/literals with metavariables), and searches
 * a codebase for structurally similar snippets.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CloneMatch, CloneLanguage, CloneSearchResult, SemgrepOutput, SemgrepResult } from './types.js';

// ── Language-to-Semgrep language map ────────────────────────

const LANG_MAP: Record<CloneLanguage, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  go: 'go',
  java: 'java',
  jsx: 'js',
  tsx: 'ts',
};

// ── Fragment → Structural Pattern ───────────────────────────

const IDENTIFIER_RE = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
const NUMBER_LITERAL_RE = /\b\d+(\.\d+)?\b/g;

/** Keywords to NOT replace with metavariables. */
const SKIP_WORDS = new Set([
  'function', 'const', 'let', 'var', 'class', 'interface', 'type', 'enum',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'return', 'throw', 'try', 'catch', 'finally', 'new', 'delete', 'typeof',
  'instanceof', 'void', 'in', 'of', 'import', 'export', 'from', 'default',
  'async', 'await', 'yield', 'this', 'super', 'true', 'false', 'null',
  'undefined', 'number', 'string', 'boolean', 'any', 'never', 'unknown',
  'public', 'private', 'protected', 'static', 'readonly', 'abstract',
  'extends', 'implements', 'as', 'satisfies', 'keyof', 'typeof',
  'and', 'or', 'not', 'is', 'def', 'lambda',
  'console', 'process', 'Math', 'JSON', 'Promise', 'Array', 'Object',
  'String', 'Number', 'Boolean', 'Error', 'Date', 'RegExp', 'Map', 'Set',
  'Symbol', 'Buffer',
]);

/**
 * Convert a code fragment into a Semgrep structural pattern.
 *
 * Strategy:
 * - Function/class/variable names → $ID_0, $ID_1 (metavariables)
 * - Number literals → $NUM_0, $NUM_1 (metavariables)
 * - Control flow keywords stay as-is
 * - Consistent renaming for repeated identifiers
 */
export function fragmentToPattern(fragment: string): string {
  let pattern = fragment;
  const seenIds: Record<string, string> = {};
  let idCounter = 0;
  let numCounter = 0;

  // Replace identifiers FIRST (so they don't clobber placeholder tokens)
  pattern = pattern.replace(IDENTIFIER_RE, (match) => {
    if (SKIP_WORDS.has(match)) return match;
    if (seenIds[match] !== undefined) {
      return seenIds[match];
    }
    const metaVar = `$ID_${idCounter++}`;
    seenIds[match] = metaVar;
    return metaVar;
  });

  // Then replace number literals with $NUM_X
  pattern = pattern.replace(NUMBER_LITERAL_RE, () => `$NUM_${numCounter++}`);

  return pattern;
}

/**
 * Reset the internal variable counters. Useful for tests.
 */
export function resetVarCounter(): void {
  // no-op now since counters are local
}

// ── Helping function: structural tokens from a string ───

function extractStructuralTokens(s: string): string[] {
  const tokens: string[] = [];
  const re = /[{}\[\]()<>;,:!?=+\-*/%&|^~]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

function extractIdentifiers(s: string): string[] {
  return (s.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || [])
    .filter(id => !SKIP_WORDS.has(id));
}

function extractNumbers(s: string): string[] {
  return s.match(/\b\d+(\.\d+)?\b/g) || [];
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  let union = 0;

  // Compute intersection and union without for-of on sets
  const allItems = new Set([...a, ...b]);
  for (const item of allItems) {
    if (setA.has(item) && setB.has(item)) {
      intersection++;
    }
    union++;
  }
  return union > 0 ? intersection / union : 1;
}

// ── Confidence scoring ──────────────────────────────────────

/**
 * Compute a confidence score for a clone match by comparing
 * the original fragment's structure against the matched code.
 */
export function computeConfidence(fragment: string, matchedCode: string): number {
  const fLines = fragment.trim().split('\n').length;
  const mLines = matchedCode.trim().split('\n').length;
  const maxLines = Math.max(fLines, mLines);
  const minLines = Math.min(fLines, mLines);
  const lineRatio = maxLines > 0 ? minLines / maxLines : 0;

  const fNorm = fragment.replace(/\s+/g, ' ').trim();
  const mNorm = matchedCode.replace(/\s+/g, ' ').trim();

  const fStruct = extractStructuralTokens(fNorm);
  const mStruct = extractStructuralTokens(mNorm);
  const structScore = jaccardSimilarity(fStruct, mStruct);

  const combined = structScore * 0.7 + lineRatio * 0.3;
  const adjusted = combined > 0.95 ? 0.95 : combined;

  return Math.round(Math.min(adjusted, 1.0) * 100) / 100;
}

// ── Run Semgrep ─────────────────────────────────────────────

/**
 * Find structural clones of a code fragment in a codebase using Semgrep.
 */
export async function findClones(
  fragment: string,
  language: CloneLanguage,
  searchPath: string,
  options?: {
    minConfidence?: number;
    maxResults?: number;
  },
): Promise<CloneSearchResult> {
  const startTime = Date.now();
  const semgrepLang = LANG_MAP[language];

  if (!semgrepLang) {
    throw new Error(`Unsupported language: ${language}`);
  }

  if (!fs.existsSync(searchPath)) {
    throw new Error(`Search path does not exist: ${searchPath}`);
  }

  // Convert fragment to structural pattern
  const structuralPattern = fragmentToPattern(fragment);

  // Run semgrep
  const result = spawnSync('semgrep', [
    '--json',
    '--pattern', structuralPattern,
    '--lang', semgrepLang,
    searchPath,
  ], {
    encoding: 'utf-8',
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new Error('semgrep is not installed. Run: pip3 install semgrep');
  }

  let output: SemgrepOutput;
  try {
    output = JSON.parse(result.stdout || '{}') as SemgrepOutput;
  } catch {
    output = { results: [], errors: [], paths: { scanned: [] } };
  }

  const filesScanned = (output.paths?.scanned?.length) ?? 0;

  // Convert Semgrep results to CloneMatches
  const matches: CloneMatch[] = (output.results || []).map((r: SemgrepResult) => {
    const matchedCode = r.extra?.lines || '';
    const confidence = computeConfidence(fragment, matchedCode);
    const fNorm = fragment.replace(/\s+/g, ' ').trim();
    const mNorm = matchedCode.replace(/\s+/g, ' ').trim();

    const fIds = extractIdentifiers(fNorm);
    const mIds = extractIdentifiers(mNorm);
    const idJaccard = jaccardSimilarity(fIds, mIds);
    const renamed = fIds.length > 0 && idJaccard < 0.5;

    const fLits = extractNumbers(fNorm);
    const mLits = extractNumbers(mNorm);
    const litJaccard = jaccardSimilarity(fLits, mLits);
    const literalDiffers = fLits.length > 0 && litJaccard < 0.3;

    const fStruct = extractStructuralTokens(fNorm);
    const mStruct = extractStructuralTokens(mNorm);
    const structScore = jaccardSimilarity(fStruct, mStruct);

    return {
      filePath: r.path,
      startLine: r.start.line,
      endLine: r.end.line,
      column: r.start.col,
      confidence,
      matchedCode,
      similarity: {
        structural: structScore,
        renamed,
        literalDiffers,
      },
    };
  });

  // Filter by confidence
  const minConfidence = options?.minConfidence ?? 0.6;
  const filtered = matches.filter(m => m.confidence >= minConfidence);

  // Sort by confidence descending
  filtered.sort((a, b) => b.confidence - a.confidence);

  // Cap results
  const maxResults = options?.maxResults ?? 20;
  const capped = filtered.slice(0, maxResults);

  return {
    fragment,
    language,
    searchPath,
    filesScanned,
    matches: capped,
    totalMatches: filtered.length,
    durationMs: Date.now() - startTime,
  };
}
