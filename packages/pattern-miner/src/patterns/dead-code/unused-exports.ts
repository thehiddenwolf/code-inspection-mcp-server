import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

export interface FileExports {
  path: string;
  exports: string[];
  lines: Map<string, number>;
}

/**
 * Regex-based detection of exported symbols that have no imports elsewhere.
 * Walks all JS/TS files, collects exports and imports, then reports
 * exports that are never referenced across the project.
 */
export async function detectUnusedExports(
  files: { path: string; content: string }[],
): Promise<PatternMatchType[]> {
  const allExports: FileExports[] = [];
  const usedSymbols = new Set<string>();

  // First pass: collect all exports and imports
  const exportRegex = /export\s+(?:default\s+)?(?:function|const|let|var|class|interface|type|enum|abstract\s+class)\s+(\w+)/g;
  const namedExportRegex = /export\s*\{\s*([^}]+)\s*\}/g;
  const importRegex = /(?:import\s+(?:\{[^}]*\}|[^;{]+)|require\s*\(\s*['"][^'"]+['"]\s*\))/g;

  for (const file of files) {
    const exports: string[] = [];
    const linesMap = new Map<string, number>();
    const lines = file.content.split('\n');
    let match: RegExpExecArray | null;

    // Reset regex state
    exportRegex.lastIndex = 0;
    namedExportRegex.lastIndex = 0;
    importRegex.lastIndex = 0;

    // Find named exports
    while ((match = exportRegex.exec(file.content)) !== null) {
      const symbol = match[1];
      const lineNum = file.content.substring(0, match.index).split('\n').length;
      exports.push(symbol);
      linesMap.set(symbol, lineNum);
    }

    // Find named exports in braces
    while ((match = namedExportRegex.exec(file.content)) !== null) {
      const inner = match[1];
      for (const part of inner.split(',')) {
        const trimmed = part.trim();
        // Handle "X as Y" syntax
        const asMatch = trimmed.match(/(\w+)(?:\s+as\s+(\w+))?/);
        if (asMatch) {
          const sym = asMatch[2] || asMatch[1];
          const lineNum = file.content.substring(0, match.index).split('\n').length;
          exports.push(sym);
          if (!linesMap.has(sym)) {
            linesMap.set(sym, lineNum);
          }
        }
      }
    }

    if (exports.length > 0) {
      allExports.push({ path: file.path, exports, lines: linesMap });
    }

    // Collect imported symbols from relative imports
    while ((match = importRegex.exec(file.content)) !== null) {
      const imp = match[0];
      // Only track relative imports for cross-file usage
      if (imp.includes('from') && !imp.includes("'./") && !imp.includes('"../') && !imp.includes("'../") && !imp.includes('"./')) {
        continue;
      }

      // Extract imported symbol names
      const namedImport = imp.match(/\{\s*([^}]+)\s*\}/);
      if (namedImport) {
        for (const part of namedImport[1].split(',')) {
          const sym = part.trim().split(/\s+as\s+/).pop()?.trim();
          if (sym) usedSymbols.add(sym);
        }
      } else {
        // Default import
        const defaultMatch = imp.match(/import\s+(\w+)\s+from/);
        if (defaultMatch) usedSymbols.add(defaultMatch[1]);
      }
    }
  }

  // Filter: only symbols that are exported but never imported
  const findings: PatternMatchType[] = [];
  for (const fileExports of allExports) {
    for (const sym of fileExports.exports) {
      if (!usedSymbols.has(sym)) {
        const line = fileExports.lines.get(sym) || 1;
        findings.push({
          pattern_id: 'unused-exports',
          pattern_name: 'Unused Export',
          file_path: fileExports.path,
          line,
          column: 0,
          message: `Export '${sym}' is defined but never imported elsewhere`,
          severity: 'warning' as PatternSeverityType,
          category: 'dead_code' as PatternCategoryType,
          snippet: `export ${sym}`,
        });
      }
    }
  }

  return findings;
}
