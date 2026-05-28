import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

/**
 * Detect circular dependencies between files by analyzing import/require statements.
 * Builds a dependency graph and looks for cycles.
 */
export async function detectCircularDeps(
  files: { path: string; content: string }[],
): Promise<PatternMatchType[]> {
  const findings: PatternMatchType[] = [];

  // Build dependency graph: map of file -> related imports
  const depGraph = new Map<string, string[]>();

  // Regex for import statements with relative paths
  const importRegex = /(?:from\s+['"](\.\.?\/[^'"]+)['"]|require\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\))/g;

  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py)$/.test(file.path)) continue;

    const imports: string[] = [];
    let match: RegExpExecArray | null;

    importRegex.lastIndex = 0;
    while ((match = importRegex.exec(file.content)) !== null) {
      // Either group 1 (from) or group 2 (require)
      const importPath = match[1] || match[2];
      imports.push(importPath);
    }

    depGraph.set(file.path, imports);
  }

  // Resolve relative imports to actual file paths
  function resolveImport(fromFile: string, importPath: string): string | null {
    const fromDir = fromFile.substring(0, fromFile.lastIndexOf('/'));

    // Normalize the path
    const parts = [...fromDir.split('/'), ...importPath.split('/')];
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '.' || part === '') continue;
      if (part === '..') {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }

    // Try common extensions
    const basePath = resolved.join('/');
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '/index.ts', '/index.js', '/index.tsx'];

    for (const ext of extensions) {
      const candidate = basePath + ext;
      if (depGraph.has(candidate)) return candidate;
    }

    // Try directory index files
    const dirIndex = basePath + '/index';
    for (const ext of ['.ts', '.js', '.tsx', '.jsx', '.mjs']) {
      if (depGraph.has(dirIndex + ext)) return dirIndex + ext;
    }

    return null;
  }

  // Detect cycles using DFS
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const pathStack: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    inStack.add(node);
    pathStack.push(node);

    const imports = depGraph.get(node) || [];
    for (const rawImport of imports) {
      // Skip non-relative imports
      if (!rawImport.startsWith('.') && !rawImport.startsWith('/')) continue;

      const resolved = resolveImport(node, rawImport);
      if (!resolved || !depGraph.has(resolved)) continue;

      if (!visited.has(resolved)) {
        dfs(resolved);
      } else if (inStack.has(resolved)) {
        // Found a cycle: extract the cycle path
        const cycleStart = pathStack.indexOf(resolved);
        const cycle = pathStack.slice(cycleStart);
        cycle.push(resolved); // Close the cycle

        const cycleStr = cycle.join(' → ');

        findings.push({
          pattern_id: 'circular-deps',
          pattern_name: 'Circular Dependency',
          file_path: node,
          line: 1,
          column: 0,
          message: `Circular dependency detected: ${cycleStr}`,
          severity: 'error',
          category: 'architecture',
          snippet: `Cycle: ${cycleStr}`,
        });
      }
    }

    pathStack.pop();
    inStack.delete(node);
  }

  // Run DFS on each unvisited node
  for (const filePath of depGraph.keys()) {
    if (!visited.has(filePath)) {
      dfs(filePath);
    }
  }

  // Deduplicate by message
  const seen = new Set<string>();
  return findings.filter(f => {
    if (seen.has(f.message)) return false;
    seen.add(f.message);
    return true;
  });
}
