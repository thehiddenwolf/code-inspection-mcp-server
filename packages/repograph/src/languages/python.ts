import type { LanguageParser } from './parser.js';
import type { Symbol, GraphEdge, GraphEdgeType } from '../types.js';

// Python Regex Patterns - matching up to the end of the line to prevent greedy newline matching
const PY_IMPORT_RE = /^\s*import\s+([^\r\n]+)/gm;
const PY_FROM_IMPORT_RE = /^\s*from\s+([\w.]+)\s+import\s+([^\r\n]+)/gm;

const PY_CLASS_RE = /(?:^|\n)\s*class\s+(\w+)(?:\s*\(([^)]*)\))?\s*:/g;
const PY_FUNCTION_RE = /(?:^|\n)\s*def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?\s*:/g;

export const PythonParser: LanguageParser = {
  extensions: ['.py'],

  extractImports(content: string, filePath: string) {
    const results: Array<{ source: string; names: string[]; defaultName?: string }> = [];
    const seen = new Set<string>();

    // 1. Direct imports: import os, sys
    PY_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PY_IMPORT_RE.exec(content)) !== null) {
      const modulesStr = match[1]!;
      const modules = modulesStr.split(',').map((m) => {
        const parts = m.trim().split(/\s+as\s+/);
        return parts[0]!.trim();
      });
      for (const mod of modules) {
        if (!mod) continue;
        if (!seen.has(mod)) {
          seen.add(mod);
          results.push({ source: mod, names: [] });
        }
      }
    }

    // 2. From imports: from module import x, y
    PY_FROM_IMPORT_RE.lastIndex = 0;
    while ((match = PY_FROM_IMPORT_RE.exec(content)) !== null) {
      const source = match[1]!;
      const namesStr = match[2]!.replace(/[()]/g, ''); // strip parentheses if multiline import
      const names = namesStr.split(',').map((n) => {
        const parts = n.trim().split(/\s+as\s+/);
        return parts[parts.length - 1]!.trim();
      });
      const key = `${source}:${names.join(',')}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ source, names });
      }
    }

    return results;
  },

  extractDeclarations(content: string, filePath: string) {
    const symbols: Symbol[] = [];
    const lines = content.split('\n');
    const seen = new Set<string>();

    // Calculate line/column from regex index
    const posFromIndex = (idx: number): { line: number; column: number } => {
      for (let i = 0; i < lines.length; i++) {
        const lineLen = lines[i]!.length + 1; // +1 for newline
        if (idx < lineLen) {
          return { line: i + 1, column: idx + 1 };
        }
        idx -= lineLen;
      }
      return { line: lines.length, column: 1 };
    };

    type PyDeclPattern = { re: RegExp; type: Symbol['type'] };
    const patterns: PyDeclPattern[] = [
      { re: PY_CLASS_RE, type: 'class' },
      { re: PY_FUNCTION_RE, type: 'function' },
    ];

    for (const pat of patterns) {
      pat.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.re.exec(content)) !== null) {
        const name = m[1]!;
        if (seen.has(name)) continue;
        seen.add(name);
        const pos = posFromIndex(m.index);
        symbols.push({
          name,
          type: pat.type,
          exported: true,
          line: pos.line,
          column: pos.column,
          filePath,
        });
      }
    }

    return symbols;
  },

  extractRelationships(content: string, filePath: string) {
    const edges: GraphEdge[] = [];
    const seenEdges = new Set<string>();

    const addEdge = (fromId: string, toLabel: string, type: GraphEdgeType) => {
      const key = `${fromId}:${toLabel}:${type}`;
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
      edges.push({
        from: fromId,
        to: `sym:${toLabel}`,
        type,
      });
    };

    PY_CLASS_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PY_CLASS_RE.exec(content)) !== null) {
      const className = m[1]!;
      const basesStr = m[2];
      if (basesStr) {
        const bases = basesStr.split(',').map((b) => b.trim().split('[')[0]!.trim());
        const fromId = `sym:${className}@${filePath}`;
        for (const base of bases) {
          if (base && base !== 'object') {
            addEdge(fromId, base, 'extends');
          }
        }
      }
    }

    return edges;
  },
};
