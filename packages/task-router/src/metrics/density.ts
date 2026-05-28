import { MetricResult } from '../types.js';
import { Metric } from './metric.js';

/**
 * Dependency Density metric — measures import density relative to code size.
 *
 * While the `dependencies` metric counts raw imports, this metric focuses on
 * *density*: how many imports exist per logical line of code, plus the
 * complexity of the import graph (depth, ratio of internal vs external).
 *
 * A file with 200 imports across 50 lines is very dense and likely has
 * coupling problems. A file with 10 imports across 500 lines is loosely
 * coupled and easier to isolate for testing.
 *
 * Scoring dimensions:
 *   - Import density (imports per 100 logical lines) — higher = tighter coupling
 *   - Depth-weighted density — penalises deep relative chains (../../..)
 *   - External ratio — high external dependency ratio increases risk surface
 *
 * Scores are normalised to 0–100.
 */

const RELATIVE_IMPORT_RE = /^\.\.?\/?/;

interface ParsedImports {
  total: number;
  external: number;
  internal: number;
  maxDepth: number;
}

/**
 * Parse imports from source code (ESM + CJS).
 */
function parseImports(code: string): ParsedImports {
  const normalized = code.replace(/\r\n/g, '\n');
  // Remove comments only — NOT string contents, which would
  // destroy the import source paths we need to capture
  const cleaned = normalized
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const sources: string[] = [];

  // ESM import ... from '...'
  const importFromRe =
    /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importFromRe.exec(cleaned)) !== null) {
    sources.push(m[1]);
  }

  // Dynamic import(...)
  const dynamicRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynamicRe.exec(cleaned)) !== null) {
    sources.push(m[1]);
  }

  // CJS require(...)
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRe.exec(cleaned)) !== null) {
    sources.push(m[1]);
  }

  let external = 0;
  let internal = 0;
  let maxDepth = 0;

  for (const src of sources) {
    if (RELATIVE_IMPORT_RE.test(src)) {
      internal++;
      const upLevels = (src.match(/\.\.\//g) || []).length;
      const depth = upLevels + (src.startsWith('./') ? 1 : 0);
      maxDepth = Math.max(maxDepth, depth);
    } else {
      external++;
    }
  }

  return { total: sources.length, external, internal, maxDepth };
}

export class DensityMetric implements Metric {
  readonly name = 'density';

  compute(code: string, _language?: string): MetricResult {
    const normalized = code.replace(/\r\n/g, '\n');

    // Count logical lines (non-blank, non-comment)
    const allLines = normalized.split('\n');
    const logicalLines = allLines.filter((l) => {
      const t = l.trim();
      if (t.length === 0) return false;
      if (t.startsWith('//')) return false;
      if (t.startsWith('*') || t.startsWith('/*')) return false;
      return true;
    });
    const totalLogical = logicalLines.length;

    const parsed = parseImports(normalized);
    const { total: totalImports, external, internal, maxDepth } = parsed;

    // --- Scoring ---

    // 1. Import density: imports per 100 logical lines (0-40 pts)
    //    Density > 20 imports/100LOC → max penalty of 40
    const density = totalLogical > 0 ? (totalImports / totalLogical) * 100 : 0;
    const densityScore = Math.min(40, (density / 20) * 40);

    // 2. Depth-weighted density (0-30 pts)
    //    maxDepth > 5 → max penalty; each level of depth adds
    const depthPenalty = Math.min(30, maxDepth * 6);

    // 3. External dependency ratio (0-30 pts)
    //    High external ratio = more third-party risk surface
    const ratio = totalImports > 0 ? external / totalImports : 0;
    const ratioScore = Math.min(30, ratio * 30);

    const rawScore = densityScore + depthPenalty + ratioScore;
    const capped = Math.min(rawScore, 100);

    const details = [
      `Import density: ${density.toFixed(1)} per 100 LOC → ${densityScore.toFixed(1)} pts`,
      `Max depth: ${maxDepth} → ${depthPenalty.toFixed(1)} pts`,
      `External ratio: ${(ratio * 100).toFixed(0)}% → ${ratioScore.toFixed(1)} pts`,
      `(total: ${totalImports} imports, ${external} external, ${internal} internal, ${totalLogical} logical LOC)`,
      `→ weighted score: ${capped.toFixed(1)}`,
    ].join('; ');

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
