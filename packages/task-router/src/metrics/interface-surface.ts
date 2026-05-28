import { MetricResult } from '../types.js';
import { Metric } from './metric.js';

/**
 * Public API surface metric.
 *
 * Counts exported functions, exported classes, exported methods on
 * exported classes, and total parameter count across exported
 * scores. A larger API surface increases cognitive load for
 * consumers, so it is incorporated into the overall complexity score.
 *
 * Scoping: we look at `export` keyword followed by:
 *   - `function` / `async function`
 *   - `class`
 *   - `const` / `let` / `var` (arrow functions assigned to exported variables)
 *   - `default` (export default ...)
 *   - `interface` / `type` (TypeScript)
 *
 * For classes, we also count public methods.
 */

interface SurfaceCounts {
  exportedFunctions: number;
  exportedClasses: number;
  exportedTypes: number;
  classMethods: number;
  totalParameters: number;
}

// Regex to find exported declarations
function parseSurface(code: string): SurfaceCounts {
  const normalised = code.replace(/\r\n/g, '\n');

  // Remove comments & strings for cleaner matching
  const cleaned = normalised
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'.*?'/g, "''")
    .replace(/".*?"/g, '""')
    .replace(/`[\s\S]*?`/g, '');

  let exportedFunctions = 0;
  let exportedClasses = 0;
  let exportedTypes = 0;
  let classMethods = 0;
  let totalParameters = 0;

  // --- Exported functions ---
  // `export function name(` or `export async function name(`
  const exportFnRe = /export\s+(async\s+)?function\s+\w+\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = exportFnRe.exec(cleaned)) !== null) {
    exportedFunctions++;
  }

  // `export default function`
  const exportDefaultFnRe = /export\s+default\s+(async\s+)?function\s*/g;
  while ((m = exportDefaultFnRe.exec(cleaned)) !== null) {
    exportedFunctions++;
  }

  // Exported arrow assigned to const/let/var: `export const name = (`
  // Must not be followed by `=` (that would be a value assignment not a function)
  const exportArrowRe = /export\s+(const|let|var)\s+\w+\s*=\s*(\([^)]*\)|\w+)\s*=>/g;
  while ((m = exportArrowRe.exec(cleaned)) !== null) {
    exportedFunctions++;
  }

  // --- Exported classes ---
  const exportClassRe = /export\s+(default\s+)?class\s+\w+/g;
  while ((m = exportClassRe.exec(cleaned)) !== null) {
    exportedClasses++;
  }

  // --- Exported types / interfaces ---
  const exportTypeRe = /export\s+(type|interface)\s+\w+/g;
  while ((m = exportTypeRe.exec(cleaned)) !== null) {
    exportedTypes++;
  }

  // --- Class methods ---
  // Match lines inside class bodies that define methods: `methodName(` or `async methodName(`
  // We find a class body `{` ... `}` and count method definitions.
  // Simplified: count method-looking definitions that aren't preceded by `export`
  // and are inside a class context (preceded by indentation).
  const methodRe = /^\s+(async\s+)?(get\s+|set\s+)?(\w+)\s*\(/gm;
  // This is imprecise but good enough: count all indented function-like patterns
  // as potential methods, then subtract the exported function count to avoid
  // double-counting methods that are also exported separately.
  let methodCount = 0;
  while ((m = methodRe.exec(cleaned)) !== null) {
    // Skip keywords, constructors, and likely non-method patterns
    const name = m[3];
    if (
      name === 'if' || name === 'while' || name === 'for' ||
      name === 'switch' || name === 'catch' || name === 'return' ||
      name === 'throw' || name === 'constructor'
    ) continue;
    methodCount++;
  }
  classMethods = Math.max(0, methodCount - exportedFunctions);

  // --- Parameters ---
  // Match function parameter lists: `(param1, param2, ...)`
  // Simple: count commas between parentheses in function-like contexts
  const paramLists = cleaned.match(/\(([^)]*)\)\s*(?::\s*\w+|=>|\{)/g) || [];
  for (const plist of paramLists) {
    // Extract inner content
    const inner = plist.slice(1, plist.indexOf(')'));
    if (inner.trim() === '') continue;
    // Split by comma, filter empty/rest/null patterns
    const params = inner.split(',').map(p => p.trim()).filter(p => {
      if (!p) return false;
      if (p === '...') return false;
      return true;
    });
    totalParameters += params.length;
  }

  return {
    exportedFunctions,
    exportedClasses,
    exportedTypes,
    classMethods,
    totalParameters,
  };
}

export class InterfaceSurfaceMetric implements Metric {
  readonly name = 'interface-surface';

  /**
   * Compute interface-surface complexity score.
   *
   * Scoring formula:
   *   surface = exportedFunctions * 2 + exportedClasses * 3 +
   *             exportedTypes * 1 + classMethods * 1.5 +
   *             totalParameters * 0.5
   *
   * Capped at 100.
   */
  compute(code: string, _language?: string): MetricResult {
    const counts = parseSurface(code);

    const rawScore =
      counts.exportedFunctions * 2 +
      counts.exportedClasses * 3 +
      counts.exportedTypes * 1 +
      counts.classMethods * 1.5 +
      counts.totalParameters * 0.5;

    const capped = Math.min(rawScore, 100);

    const details =
      `Exported functions: ${counts.exportedFunctions}, ` +
      `exported classes: ${counts.exportedClasses}, ` +
      `exported types/interfaces: ${counts.exportedTypes}, ` +
      `class methods: ${counts.classMethods}, ` +
      `total parameters: ${counts.totalParameters} ` +
      `→ weighted score: ${capped.toFixed(1)}`;

    return {
      name: this.name,
      score: Math.round(capped * 10) / 10,
      details,
    };
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name };
  }
}
