import { MetricResult } from '../types.js';
import { Metric } from './metric.js';

/**
 * Import/require chain analysis metric.
 *
 * Counts import statements and require() calls, categorises them as
 * external (npm packages / standard library) vs internal (relative or
 * absolute project imports), and estimates dependency depth as the
 * maximum depth of relative paths.
 */

interface ImportCounts {
  total: number;
  external: number;
  standardLib: number;
  internal: number;
  maxDepth: number;
}

// Node.js / TypeScript built-in module names
const STD_LIB_MODULES = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster',
  'console', 'constants', 'crypto', 'dgram', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream',
  'string_decoder', 'timers', 'tls', 'trace_events', 'tty',
  'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const RELATIVE_IMPORT_RE = /^\.\.?\/?/;

/**
 * Parse a source string to find all import/require statements and
 * classify them by origin.
 */
function parseImports(code: string): ImportCounts {
  // Normalize line endings
  const normalised = code.replace(/\r\n/g, '\n');

  // Remove comments for cleaner matching (but NOT string contents —
  // stripping strings would destroy the import source paths we need to capture)
  const cleaned = normalised
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const sources: string[] = [];

  // ESM: import ... from '...'
  const importFromRe = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)\s+from\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importFromRe.exec(cleaned)) !== null) {
    sources.push(match[1]);
  }

  // Dynamic import(...)
  const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRe.exec(cleaned)) !== null) {
    sources.push(match[1]);
  }

  // CJS: require('...')
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRe.exec(cleaned)) !== null) {
    sources.push(match[1]);
  }

  // CJS: require.resolve('...')
  const requireResolveRe = /require\.resolve\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireResolveRe.exec(cleaned)) !== null) {
    sources.push(match[1]);
  }

  let external = 0;
  let stdLib = 0;
  let internal = 0;
  let maxDepth = 0;

  for (const src of sources) {
    if (RELATIVE_IMPORT_RE.test(src)) {
      internal++;
      // Count `../` segments for depth
      const upLevels = (src.match(/\.\.\//g) || []).length;
      // Add 1 for the directory itself if it has a path component beyond `./`
      const depth = upLevels + (src.startsWith('./') ? 1 : 0);
      maxDepth = Math.max(maxDepth, depth);
    } else {
      // Check if it's a standard lib module
      const moduleName = src.split('/')[0]; // handle scoped modules: @scope/pkg
      if (STD_LIB_MODULES.has(moduleName)) {
        stdLib++;
      } else {
        external++;
      }
    }
  }

  return {
    total: sources.length,
    external,
    standardLib: stdLib,
    internal,
    maxDepth,
  };
}

export class DependencyMetric implements Metric {
  readonly name = 'dependencies';

  /**
   * Compute dependency complexity score.
   *
   * Scoring heuristic:
   *   - Each import = base 1 point
   *   - External dependencies weighted more (1.5×)
   *   - Standard library imports weighted less (0.5×)
   *   - Internal dependency depth adds penalty (depth × 2)
   *
   * Normalised to a 0–100 scale typical for this dimension.
   */
  compute(code: string, _language?: string): MetricResult {
    const counts = parseImports(code);

    // Raw score: weighted sum
    const rawScore =
      counts.standardLib * 0.5 +
      counts.external * 1.5 +
      counts.internal +
      counts.maxDepth * 2;

    // Cap at a reasonable max for normalisation
    const capped = Math.min(rawScore, 100);

    const details =
      `Total imports: ${counts.total} ` +
      `(external: ${counts.external}, standard-lib: ${counts.standardLib}, ` +
      `internal: ${counts.internal}, max-depth: ${counts.maxDepth}) ` +
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
