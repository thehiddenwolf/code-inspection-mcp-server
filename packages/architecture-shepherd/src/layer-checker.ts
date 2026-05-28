/**
 * Layer checker for ArchitectureShepherd.
 * Validates file imports against layer boundary rules defined in a manifest.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Ignore from 'ignore';
import type { Manifest } from './manifest-parser.js';
import { getLayerForPath, isImportAllowed } from './manifest-parser.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface LayerViolation {
  file: string;
  line: number;
  fromLayer: string;
  toLayer: string;
  importPath: string;
  reason: string;
}

export interface LayerCheckResult {
  violations: LayerViolation[];
  checkedFiles: number;
}

// ── Import extraction ───────────────────────────────────────────────────────

const IMPORT_PATTERNS = [
  // ES module imports: import ... from '...'
  /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/,
  // Dynamic imports: import('...')
  /^\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  // require calls: require('...')
  /^\s*(?:const\s+\w+\s*=\s*)?require\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/,
];

/**
 * Extract import paths from a single line of source code.
 */
function extractImports(line: string): string[] {
  const imports: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      imports.push(match[1]);
    }
  }
  return imports;
}

/**
 * Map an import path to a layer name based on the manifest and the importing file's location.
 */
function resolveImportLayer(
  importPath: string,
  sourceFile: string,
  manifest: Manifest,
): string | null {
  // Relative imports: resolve relative to source file
  if (importPath.startsWith('.')) {
    const resolvedDir = path.dirname(sourceFile);
    const resolved = path.resolve(resolvedDir, importPath);
    return getLayerForPath(resolved, manifest);
  }

  // Package imports: use the package scope or name to guess layer
  if (!importPath.startsWith('.')) {
    // Check if it's a scoped or named package that matches a component
    const parts = importPath.split('/');
    // Handle @scope/package
    const packageScope = parts.length >= 2 && parts[0].startsWith('@')
      ? `${parts[0]}/${parts[1]}`
      : parts[0];

    for (const comp of manifest.components) {
      if (comp.path.endsWith(packageScope) || packageScope.startsWith(comp.path)) {
        return comp.layer;
      }
    }

    // Check if it's a node built-in — these are always allowed
    if (
      importPath.startsWith('node:') ||
      ['fs', 'path', 'os', 'crypto', 'events', 'http', 'stream', 'util', 'buffer', 'child_process'].includes(importPath)
    ) {
      return null; // null means "system layer" — always allowed
    }
  }

  return null;
}

// ── File scanning ───────────────────────────────────────────────────────────

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.php',
]);

/**
 * Check a list of file paths against a manifest for layer boundary violations.
 */
export function checkFiles(
  filePaths: string[],
  manifest: Manifest,
  ignorePatterns?: string[],
): LayerCheckResult {
  const violations: LayerViolation[] = [];
  let checkedFiles = 0;

  let ig: ReturnType<typeof Ignore> | null = null;
  if (ignorePatterns && ignorePatterns.length > 0) {
    ig = Ignore().add(ignorePatterns);
  }

  for (const filePath of filePaths) {
    // Skip non-existent files
    if (!fs.existsSync(filePath)) continue;

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    // Check ignore patterns
    if (ig && ig.ignores(filePath)) continue;

    // Only check source files
    const ext = path.extname(filePath).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) continue;

    const fromLayer = getLayerForPath(filePath, manifest);
    if (!fromLayer) continue; // File not mapped to any layer — skip

    checkedFiles++;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const imports = extractImports(line);

      for (const importPath of imports) {
        // Skip node built-ins and external packages
        if (importPath.startsWith('node:') || !importPath.startsWith('.')) {
          continue;
        }

        const toLayer = resolveImportLayer(importPath, filePath, manifest);

        // If we can't determine the target layer, skip
        if (!toLayer) continue;

        // Check if the import is allowed
        if (!isImportAllowed(fromLayer, toLayer, manifest)) {
          violations.push({
            file: filePath,
            line: i + 1,
            fromLayer,
            toLayer,
            importPath,
            reason: `Layer "${fromLayer}" is not allowed to import from layer "${toLayer}". Allowed dependencies: [${manifest.layers.find((l) => l.name === fromLayer)?.dependsOn.join(', ') ?? 'none'}]`,
          });
        }
      }
    }
  }

  return { violations, checkedFiles };
}
