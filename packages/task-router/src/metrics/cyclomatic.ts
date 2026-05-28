import { MetricResult } from '../types.js';
import { Metric } from './metric.js';

/**
 * Cyclomatic Complexity metric — McCabe-style decision-point counter.
 *
 * Uses a lightweight regex-based approach that works across most C-family
 * languages (TypeScript, JavaScript, Python, Java, C, C++, etc.).
 *
 * Decision points counted:
 *   - if / else if        (+1 per conditional branch — the `if` regex
 *                           naturally catches `else if` since it contains
 *                           `if (`)
 *   - while                (+1 per precondition loop)
 *   - do…while             (+1 per postcondition loop)
 *   - for / for-of / for-in (+1 per loop)
 *   - switch               (+1 per switch statement)
 *   - case / default       (+1 per case/default label in a switch)
 *   - catch                (+1 per exception handler)
 *   - && (logical AND)     (+1 per short-circuit, weighted 0.5)
 *   - || (logical OR)      (+1 per short-circuit, weighted 0.5)
 *   - ternary (? :)        (+1 per ternary conditional)
 *
 * Base complexity = 1 (a straight-line function has complexity 1).
 *
 * McCabe's original formula: M = E - N + 2P
 * This simplified counting approach (base 1 + decision points) is equivalent
 * for single-function analysis.
 */

// Regex patterns for each decision-point type.
// Note: `else if` is NOT listed separately — the `if` regex naturally matches
// `else if (...)` since it contains `if (`. We avoid a redundant pattern.
const PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'if', regex: /\bif\s*\(/g },
  { name: 'while', regex: /\bwhile\s*\(/g },
  { name: 'for', regex: /\bfor\s*\(/g },
  { name: 'switch', regex: /\bswitch\s*\(/g },
  { name: 'case', regex: /\bcase\s+/g },
  // default: — note the colon is required to avoid matching the keyword in
  // other contexts (e.g. `default` in a destructuring or export default).
  { name: 'default', regex: /\bdefault\s*:/g },
  { name: 'catch', regex: /\bcatch\s*\(/g },
  // Ternary: match `?` … `:` but the inner content may itself contain `?` or
  // `:` (nested ternaries), so we use a greedy scan between outermost `?` and
  // `:` that balances nesting. For simplicity, we match `? <expr> : <expr>`
  // where <expr> may contain one level of nested `? … :`.
  { name: 'ternary', regex: /\?\s*[^:;)]+?\s*:/g },
];

/**
 * Count && and || operators after stripping strings and comments.
 * These are logical short-circuit operators that add branching paths.
 */
function countLogicalOperators(code: string): { and: number; or: number } {
  const cleaned = code
    .replace(/'.*?'/g, '')
    .replace(/".*?"/g, '')
    .replace(/`.*?`/gs, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const andMatches = cleaned.match(/&&/g);
  const orMatches = cleaned.match(/\|\|/g);

  return {
    and: andMatches ? andMatches.length : 0,
    or: orMatches ? orMatches.length : 0,
  };
}

export class CyclomaticMetric implements Metric {
  readonly name = 'cyclomatic';

  compute(code: string, _language?: string): MetricResult {
    const normalized = code.replace(/\r\n/g, '\n');

    // Remove comments and string literals for cleaner matching
    const cleaned = normalized
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/'.*?'/g, "''")
      .replace(/".*?"/g, '""')
      .replace(/`[\s\S]*?`/g, '');

    // Count decision points from patterns
    const counts: Record<string, number> = {};

    for (const { name, regex } of PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      let count = 0;
      while ((match = regex.exec(cleaned)) !== null) {
        count++;
      }
      counts[name] = count;
    }

    const logicals = countLogicalOperators(normalized);

    // Base complexity is 1 (a straight-line function has complexity 1)
    let score = 1;

    score += counts['if'] ?? 0;
    score += counts['while'] ?? 0;
    score += counts['for'] ?? 0;
    score += counts['switch'] ?? 0;
    score += counts['case'] ?? 0;
    score += counts['default'] ?? 0;
    score += counts['catch'] ?? 0;
    score += counts['ternary'] ?? 0;

    // Logical operators weighted at 0.5 each (they represent half a branch)
    score += logicals.and * 0.5;
    score += logicals.or * 0.5;

    // Build human-readable breakdown
    const parts: string[] = ['Base: 1'];
    if (counts['if']) parts.push(`if/else-if: ${counts['if']}`);
    if (counts['while']) parts.push(`while: ${counts['while']}`);
    if (counts['for']) parts.push(`for: ${counts['for']}`);
    if (counts['switch']) parts.push(`switch: ${counts['switch']}`);
    if (counts['case']) parts.push(`case: ${counts['case']}`);
    if (counts['default']) parts.push(`default: ${counts['default']}`);
    if (counts['catch']) parts.push(`catch: ${counts['catch']}`);
    if (counts['ternary']) parts.push(`ternary: ${counts['ternary']}`);
    if (logicals.and) parts.push(`&&: ${logicals.and} × 0.5 = ${logicals.and * 0.5}`);
    if (logicals.or) parts.push(`||: ${logicals.or} × 0.5 = ${logicals.or * 0.5}`);

    const details = `Cyclomatic complexity = ${score.toFixed(1)} (${parts.join(' + ')})`;

    return {
      name: this.name,
      score: Math.round(score * 10) / 10,
      details,
    };
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name };
  }
}
