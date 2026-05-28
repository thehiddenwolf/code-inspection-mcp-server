/**
 * PMD CPD (Copy-Paste Detector) Tokenized Clone Detection
 *
 * Implements the token-based clone detection algorithm used by PMD's CPD:
 *   1. Tokenize source code into a normalized token stream
 *   2. Use a rolling hash (Rabin-Karp) over token windows
 *   3. Detect hash collisions → verify token-by-token
 *   4. Report clone pairs with file paths, line ranges, snippets
 *
 * References:
 *   - PMD CPD: https://pmd.sourceforge.io/pmd-6.55.0/pmd_userdocs_cpd.html
 *   - Rabin-Karp: https://en.wikipedia.org/wiki/Rabin%E2%80%93Karp_algorithm
 */

import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface CpdOptions {
  /** Minimum number of tokens for a clone (PMD default: 75 for Java, lower for dynamic langs) */
  minimumTileSize?: number;
  /** Languages to analyze */
  languages?: string[];
}

const DEFAULT_OPTIONS: Required<CpdOptions> = {
  minimumTileSize: 30,
  languages: ['typescript', 'javascript', 'python'],
};

// ── Token Types ───────────────────────────────────────────────────────────────

enum TokenType {
  KEYWORD = 'K',
  IDENTIFIER = 'I',
  LITERAL = 'L',
  OPERATOR = 'O',
  SEPARATOR = 'S',
  COMMENT = 'C',
  WHITESPACE = 'W',
  UNKNOWN = 'U',
}

interface Token {
  type: TokenType;
  /** Normalized value — identifiers become 'I', literals become 'L', etc. */
  norm: string;
  /** Raw original text */
  raw: string;
  line: number;
  column: number;
}

// ── Language-Specific Keyword Sets ────────────────────────────────────────────

const JS_TS_KEYWORDS = new Set([
  'abstract', 'as', 'any', 'asserts', 'async', 'await', 'boolean', 'break',
  'case', 'catch', 'class', 'const', 'continue', 'debugger', 'declare',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'from', 'function', 'get', 'if', 'implements', 'import',
  'in', 'instanceof', 'interface', 'is', 'keyof', 'let', 'module', 'namespace',
  'never', 'new', 'null', 'number', 'of', 'package', 'private', 'protected',
  'public', 'readonly', 'record', 'return', 'require', 'satisfies', 'set',
  'static', 'string', 'super', 'switch', 'symbol', 'this', 'throw', 'true',
  'try', 'type', 'typeof', 'undefined', 'unique', 'unknown', 'var', 'void',
  'while', 'with', 'yield',
]);

const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

// ── Tokenizer ─────────────────────────────────────────────────────────────────

const KEYWORD_PATTERN = /[a-zA-Z_$][a-zA-Z0-9_$]*/y;
const STRING_PATTERN = /(?:'[^']*'|"[^"]*"|`[^`]*`)/y;
const NUMBER_PATTERN = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?:n)?/y;
const TEMPLATE_LITERAL_PATTERN = /`[^`]*`/y;
const OPERATOR_PATTERN = /[+\-*/%=<>!&|^~?:]+/y;
const SEPARATOR_PATTERN = /[{}[\]();,.\n]/y;
const COMMENT_LINE_PATTERN = /\/\/[^\n]*/y;
const COMMENT_BLOCK_PATTERN = /\/\*[\s\S]*?\*\//y;
const PY_COMMENT_PATTERN = /#[^\n]*/y;
const PY_MULTILINE_STRING = /'''[\s\S]*?'''|"""[\s\S]*?"""/y;
const WHITESPACE_PATTERN = /[ \t]+/y;

function isKeyword(word: string, lang: string): boolean {
  if (lang === 'python') return PYTHON_KEYWORDS.has(word);
  return JS_TS_KEYWORDS.has(word);
}

/**
 * Simple line-aware tokenizer for JS/TS/Python.
 * Strips comments and whitespace, normalizes identifiers and literals.
 */
function tokenize(code: string, lang: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let lastLineStart = 0;

  function advance(count: number): void {
    // Count newlines in the matched text
    for (let i = 0; i < count; i++) {
      if (code[pos + i] === '\n') {
        line++;
        lastLineStart = pos + i + 1;
      }
    }
    pos += count;
  }

  function col(): number {
    return pos - lastLineStart + 1;
  }

  while (pos < code.length) {
    // ── Whitespace ──
    WHITESPACE_PATTERN.lastIndex = pos;
    let m = WHITESPACE_PATTERN.exec(code);
    if (m && m.index === pos) {
      advance(m[0].length);
      continue;
    }

    // Newline
    if (code[pos] === '\n') {
      line++;
      lastLineStart = pos + 1;
      pos++;
      continue;
    }

    // ── Comments ──
    COMMENT_LINE_PATTERN.lastIndex = pos;
    m = COMMENT_LINE_PATTERN.exec(code);
    if (m && m.index === pos) {
      advance(m[0].length);
      continue;
    }

    COMMENT_BLOCK_PATTERN.lastIndex = pos;
    m = COMMENT_BLOCK_PATTERN.exec(code);
    if (m && m.index === pos) {
      advance(m[0].length);
      continue;
    }

    if (lang === 'python') {
      PY_COMMENT_PATTERN.lastIndex = pos;
      m = PY_COMMENT_PATTERN.exec(code);
      if (m && m.index === pos) {
        advance(m[0].length);
        continue;
      }

      PY_MULTILINE_STRING.lastIndex = pos;
      m = PY_MULTILINE_STRING.exec(code);
      if (m && m.index === pos) {
        tokens.push({ type: TokenType.LITERAL, norm: 'L', raw: m[0], line, column: col() });
        advance(m[0].length);
        continue;
      }
    }

    // ── Strings ──
    STRING_PATTERN.lastIndex = pos;
    m = STRING_PATTERN.exec(code);
    if (m && m.index === pos) {
      tokens.push({ type: TokenType.LITERAL, norm: 'L', raw: m[0], line, column: col() });
      advance(m[0].length);
      continue;
    }

    // ── Template literals ──
    TEMPLATE_LITERAL_PATTERN.lastIndex = pos;
    m = TEMPLATE_LITERAL_PATTERN.exec(code);
    if (m && m.index === pos) {
      tokens.push({ type: TokenType.LITERAL, norm: 'L', raw: m[0], line, column: col() });
      advance(m[0].length);
      continue;
    }

    // ── Numbers ──
    NUMBER_PATTERN.lastIndex = pos;
    m = NUMBER_PATTERN.exec(code);
    if (m && m.index === pos) {
      tokens.push({ type: TokenType.LITERAL, norm: 'L', raw: m[0], line, column: col() });
      advance(m[0].length);
      continue;
    }

    // ── Identifiers / Keywords ──
    KEYWORD_PATTERN.lastIndex = pos;
    m = KEYWORD_PATTERN.exec(code);
    if (m && m.index === pos) {
      const word = m[0];
      if (isKeyword(word, lang)) {
        tokens.push({ type: TokenType.KEYWORD, norm: word, raw: word, line, column: col() });
      } else {
        tokens.push({ type: TokenType.IDENTIFIER, norm: 'I', raw: word, line, column: col() });
      }
      advance(m[0].length);
      continue;
    }

    // ── Operators ──
    OPERATOR_PATTERN.lastIndex = pos;
    m = OPERATOR_PATTERN.exec(code);
    if (m && m.index === pos) {
      tokens.push({ type: TokenType.OPERATOR, norm: 'O', raw: m[0], line, column: col() });
      advance(m[0].length);
      continue;
    }

    // ── Separators ──
    SEPARATOR_PATTERN.lastIndex = pos;
    m = SEPARATOR_PATTERN.exec(code);
    if (m && m.index === pos) {
      tokens.push({ type: TokenType.SEPARATOR, norm: m[0], raw: m[0], line, column: col() });
      advance(m[0].length);
      continue;
    }

    // ── Unknown — skip one char ──
    if (pos < code.length) {
      pos++;
    }
  }

  return tokens;
}

// ── Rabin-Karp Rolling Hash ───────────────────────────────────────────────────

/** Base for rolling hash — a prime number */
const BASE = 131;
/** Large prime for modulo */
const MOD = 2 ** 53 - 1;

/**
 * Build prefix hashes and powers for a token array.
 * Each token's hash contribution = token.norm.charCodeAt(0) * base^position
 */
function buildHashArrays(tokens: Token[]): { hashes: number[]; powers: number[] } {
  const n = tokens.length;
  const hashes = new Array<number>(n + 1);
  const powers = new Array<number>(n + 1);
  hashes[0] = 0;
  powers[0] = 1;

  for (let i = 0; i < n; i++) {
    // Use the normalized value for hashing
    const tokenVal = tokens[i].norm.charCodeAt(0) || 0;
    hashes[i + 1] = (hashes[i] * BASE + tokenVal) % MOD;
    powers[i + 1] = (powers[i] * BASE) % MOD;
  }

  return { hashes, powers };
}

/**
 * Compute hash of window tokens[start..start+length-1] using prefix hashes.
 */
function windowHash(hashes: number[], powers: number[], start: number, length: number): number {
  const end = start + length;
  const hash = (hashes[end] - hashes[start] * powers[length]) % MOD;
  return hash < 0 ? hash + MOD : hash;
}

// ── Clone Detection ───────────────────────────────────────────────────────────

export interface ClonePair {
  /** Path of the first file */
  fileA: string;
  /** Start line in the first file */
  startLineA: number;
  /** End line in the first file */
  endLineA: number;
  /** Path of the second file */
  fileB: string;
  /** Start line in the second file */
  startLineB: number;
  /** End line in the second file */
  endLineB: number;
  /** Number of tokens in the clone */
  tokenCount: number;
  /** Source snippet (first 3 lines) */
  snippet: string;
}

/**
 * PMD CPD tokenized clone detection.
 *
 * Steps:
 *   1. Tokenize all files into normalized token streams
 *   2. For each pair of (file, file), find hash-matched windows
 *   3. Verify token-by-token equality for hash collisions
 *   4. Merge adjacent clone fragments into larger clones
 *   5. Report unique clone pairs
 */
export function detectClones(
  files: { path: string; content: string }[],
  options: CpdOptions = {},
): ClonePair[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const minimumTileSize = opts.minimumTileSize;

  // ── Phase 1: Tokenize ──
  const tokenizedFiles: { path: string; tokens: Token[] }[] = [];

  for (const file of files) {
    const ext = file.path.toLowerCase();
    let lang = 'typescript';
    if (ext.endsWith('.py')) lang = 'python';
    else if (ext.endsWith('.js') || ext.endsWith('.jsx') || ext.endsWith('.mjs') || ext.endsWith('.cjs')) lang = 'javascript';

    const tokens = tokenize(file.content, lang);
    if (tokens.length >= minimumTileSize) {
      tokenizedFiles.push({ path: file.path, tokens });
    }
  }

  if (tokenizedFiles.length < 2) {
    return []; // Need at least 2 files with enough tokens
  }

  // ── Phase 2: Build hash arrays for all files ──
  const fileData = tokenizedFiles.map(f => {
    const { hashes, powers } = buildHashArrays(f.tokens);
    return { path: f.path, tokens: f.tokens, hashes, powers };
  });

  // ── Phase 3: Find clone pairs ──
  const clonePairs: Map<string, ClonePair> = new Map();

  for (let i = 0; i < fileData.length; i++) {
    for (let j = i + 1; j < fileData.length; j++) {
      const a = fileData[i];
      const b = fileData[j];

      // Use sliding window: for each window position in file A, hash it
      // and search for the same hash in file B
      const maxStartA = a.tokens.length - minimumTileSize;
      const maxStartB = b.tokens.length - minimumTileSize;

      // Build a map of hash → positions in file B (for this pair)
      const hashPositionsB = new Map<number, number[]>();
      for (let s = 0; s <= maxStartB; s++) {
        const h = windowHash(b.hashes, b.powers, s, minimumTileSize);
        const positions = hashPositionsB.get(h);
        if (positions) {
          positions.push(s);
        } else {
          hashPositionsB.set(h, [s]);
        }
      }

      // Now slide through file A and check for matches
      for (let sA = 0; sA <= maxStartA; sA++) {
        const hA = windowHash(a.hashes, a.powers, sA, minimumTileSize);
        const positionsB = hashPositionsB.get(hA);
        if (!positionsB) continue;

        for (const sB of positionsB) {
          // Phase 4: Verify token-by-token for the minimum window
          let matchLen = 0;
          while (
            sA + matchLen < a.tokens.length &&
            sB + matchLen < b.tokens.length &&
            a.tokens[sA + matchLen].norm === b.tokens[sB + matchLen].norm
          ) {
            matchLen++;
          }

          if (matchLen < minimumTileSize) continue;

          // Phase 5: Extend the match forward as far as possible
          // (already done in the while loop above)

          // Get start and end lines
          const startLineA = a.tokens[sA].line;
          const endLineA = a.tokens[sA + matchLen - 1].line;
          const startLineB = b.tokens[sB].line;
          const endLineB = b.tokens[sB + matchLen - 1].line;

          // Build a unique key for this clone pair
          const keyA = `${a.path}:${sA}-${sA + matchLen}`;
          const keyB = `${b.path}:${sB}-${sB + matchLen}`;
          const pairKey = [keyA, keyB].sort().join('||');

          // Avoid duplicate or overlapping clones — only keep the longest
          if (clonePairs.has(pairKey)) {
            const existing = clonePairs.get(pairKey)!;
            if (matchLen > existing.tokenCount) {
              // Build snippet (first 3 lines or less)
              const snippetLines: string[] = [];
              for (let k = sA; k < sA + matchLen && snippetLines.length < 3; k++) {
                if (snippetLines.length === 0 || a.tokens[k].line !== a.tokens[k - 1].line) {
                  snippetLines.push(a.tokens[k].raw);
                }
              }

              clonePairs.set(pairKey, {
                fileA: a.path,
                startLineA,
                endLineA,
                fileB: b.path,
                startLineB,
                endLineB,
                tokenCount: matchLen,
                snippet: snippetLines.join(' ').substring(0, 120),
              });
            }
            continue;
          }

          // Build snippet (first 3 lines or less)
          const snippetLines: string[] = [];
          for (let k = sA; k < sA + matchLen && snippetLines.length < 3; k++) {
            if (snippetLines.length === 0 || a.tokens[k].line !== a.tokens[k - 1].line) {
              snippetLines.push(a.tokens[k].raw);
            }
          }

          clonePairs.set(pairKey, {
            fileA: a.path,
            startLineA,
            endLineA,
            fileB: b.path,
            startLineB,
            endLineB,
            tokenCount: matchLen,
            snippet: snippetLines.join(' ').substring(0, 120),
          });
        }
      }
    }
  }

  return Array.from(clonePairs.values())
    .sort((a, b) => b.tokenCount - a.tokenCount);
}

// ── Adapter for pattern-miner catalog ─────────────────────────────────────────

/**
 * Detect code clones using PMD CPD tokenized analysis.
 * Returns PatternMatchType[] for integration with the pattern-miner scanner.
 */
export async function detectCodeClones(
  files: { path: string; content: string }[],
): Promise<PatternMatchType[]> {
  const clones = detectClones(files);
  const findings: PatternMatchType[] = [];

  // Track which files have clones to avoid redundant per-file findings
  const filesWithClones = new Set<string>();

  for (const clone of clones) {
    filesWithClones.add(clone.fileA);
    filesWithClones.add(clone.fileB);

    findings.push({
      pattern_id: 'cpd-clones',
      pattern_name: 'Code Clone (CPD)',
      file_path: clone.fileA,
      line: clone.startLineA,
      end_line: clone.endLineA,
      message: `Clone of ${clone.fileB}:${clone.startLineB}-${clone.endLineB} (${clone.tokenCount} tokens)`,
      severity: 'warning' as PatternSeverityType,
      category: 'duplication' as PatternCategoryType,
      snippet: clone.snippet,
    });

    findings.push({
      pattern_id: 'cpd-clones',
      pattern_name: 'Code Clone (CPD)',
      file_path: clone.fileB,
      line: clone.startLineB,
      end_line: clone.endLineB,
      message: `Clone of ${clone.fileA}:${clone.startLineA}-${clone.endLineA} (${clone.tokenCount} tokens)`,
      severity: 'warning' as PatternSeverityType,
      category: 'duplication' as PatternCategoryType,
      snippet: clone.snippet,
    });
  }

  return findings;
}
