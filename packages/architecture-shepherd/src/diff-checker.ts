/**
 * Diff checker for ArchitectureShepherd.
 * Parses git diffs and checks introduced lines for layer boundary violations.
 */

import { getLayerForPath, isImportAllowed } from './manifest-parser.js';
import type { Manifest } from './manifest-parser.js';
import type { LayerViolation } from './layer-checker.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface DiffResult {
  violations: LayerViolation[];
  filesChanged: number;
  linesAdded: number;
}

// ── Diff parsing ────────────────────────────────────────────────────────────

interface DiffFile {
  filePath: string;
  addedLines: Array<{ lineNumber: number; content: string }>;
}

/**
 * Parse a unified git diff into file-by-file changes.
 */
function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let lineOffset = 0;

  const lines = diff.split('\n');

  for (const line of lines) {
    // File header: diff --git a/path b/path
    const fileHeader = line.match(/^diff --git a\/(\S+) b\/(\S+)/);
    if (fileHeader) {
      if (currentFile) {
        files.push(currentFile);
      }
      currentFile = {
        filePath: fileHeader[2], // Use the "b/" path (new file)
        addedLines: [],
      };
      lineOffset = 0;
      continue;
    }

    // Hunk header: @@ -start,count +start,count @@
    const hunkHeader = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkHeader) {
      // The +start tells us the line number in the new file
      lineOffset = parseInt(hunkHeader[2], 10) - 1;
      continue;
    }

    if (!currentFile) continue;

    // Added lines start with '+', but not '+++'
    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentFile.addedLines.push({
        lineNumber: ++lineOffset,
        content: line.slice(1), // Remove the leading '+'
      });
    } else if (line.startsWith(' ')) {
      // Context line — still counts toward line offset
      lineOffset++;
    }
    // Deleted lines (starting with '-') don't affect the new file's line numbers
  }

  if (currentFile) {
    files.push(currentFile);
  }

  return files;
}

// ── Import detection (same patterns as layer-checker) ───────────────────────

const IMPORT_PATTERNS = [
  /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/,
  /^\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  /^\s*(?:const\s+\w+\s*=\s*)?require\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/,
];

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

function resolveImportLayer(
  importPath: string,
  sourceFile: string,
  manifest: Manifest,
): string | null {
  if (importPath.startsWith('.')) {
    // Resolve relative imports by path convention
    const parts = sourceFile.split('/');
    parts.pop(); // Remove filename
    const resolvedParts = resolveRelativePath(parts, importPath);
    const resolvedPath = resolvedParts.join('/');
    return getLayerForPath(resolvedPath, manifest);
  }

  if (!importPath.startsWith('.')) {
    if (
      importPath.startsWith('node:') ||
      ['fs', 'path', 'os', 'crypto', 'events', 'http', 'stream', 'util', 'buffer', 'child_process'].includes(importPath)
    ) {
      return null;
    }

    const parts = importPath.split('/');
    const packageScope = parts.length >= 2 && parts[0].startsWith('@')
      ? `${parts[0]}/${parts[1]}`
      : parts[0];

    for (const comp of manifest.components) {
      if (comp.path.endsWith(packageScope) || packageScope.startsWith(comp.path)) {
        return comp.layer;
      }
    }
  }

  return null;
}

function resolveRelativePath(baseParts: string[], relativePath: string): string[] {
  const result = [...baseParts];
  const parts = relativePath.split('/');

  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (result.length > 0) result.pop();
    } else {
      result.push(part);
    }
  }

  return result;
}

// ── Main checker ────────────────────────────────────────────────────────────

/**
 * Check a git diff for introduced layer boundary violations.
 */
export function checkDiff(diff: string, manifest: Manifest): DiffResult {
  const violations: LayerViolation[] = [];
  const files = parseDiff(diff);
  let linesAdded = 0;

  for (const file of files) {
    const fromLayer = getLayerForPath(file.filePath, manifest);
    if (!fromLayer) continue;

    linesAdded += file.addedLines.length;

    for (const { lineNumber, content } of file.addedLines) {
      const imports = extractImports(content);

      for (const importPath of imports) {
        // Skip external packages and node built-ins
        if (!importPath.startsWith('.') && !importPath.startsWith('node:')) continue;
        if (importPath.startsWith('node:')) continue;

        const toLayer = resolveImportLayer(importPath, file.filePath, manifest);
        if (!toLayer) continue;

        if (!isImportAllowed(fromLayer, toLayer, manifest)) {
          violations.push({
            file: file.filePath,
            line: lineNumber,
            fromLayer,
            toLayer,
            importPath,
            reason: `Layer "${fromLayer}" is not allowed to import from layer "${toLayer}". Allowed dependencies: [${manifest.layers.find((l) => l.name === fromLayer)?.dependsOn.join(', ') ?? 'none'}]`,
          });
        }
      }
    }
  }

  return {
    violations,
    filesChanged: files.length,
    linesAdded,
  };
}
