import type { LanguagePack } from '../types/language-pack.js';
import { posFromIndex } from './utils.js';

const PY_IMPORT_RE = /^\s*import\s+([^\r\n]+)/gm;
const PY_FROM_IMPORT_RE = /^\s*from\s+([\w.]+)\s+import\s+([^\r\n]+)/gm;
const PY_CLASS_RE = /(?:^|\n)\s*class\s+(\w+)(?:\s*\(([^)]*)\))?\s*:/g;
const PY_FUNCTION_RE = /(?:^|\n)\s*def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?\s*:/g;

const pythonRepograph = {
  extractImports(content: string, filePath: string) {
    const results: any[] = [];
    const seen = new Set<string>();

    PY_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PY_IMPORT_RE.exec(content)) !== null) {
      const modulesStr = match[1];
      const modules = modulesStr.split(',').map((m) => {
        const parts = m.trim().split(/\s+as\s+/);
        return parts[0].trim();
      });
      for (const mod of modules) {
        if (!mod) continue;
        if (!seen.has(mod)) {
          seen.add(mod);
          results.push({ source: mod, names: [] });
        }
      }
    }

    PY_FROM_IMPORT_RE.lastIndex = 0;
    while ((match = PY_FROM_IMPORT_RE.exec(content)) !== null) {
      const source = match[1];
      const namesStr = match[2].replace(/[()]/g, '');
      const names = namesStr.split(',').map((n) => {
        const parts = n.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim();
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
    const symbols: any[] = [];
    const lines = content.split('\n');
    const seen = new Set<string>();

    const patterns = [
      { re: PY_CLASS_RE, type: 'class' as const },
      { re: PY_FUNCTION_RE, type: 'function' as const },
    ];

    for (const pat of patterns) {
      pat.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.re.exec(content)) !== null) {
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        const pos = posFromIndex(content, lines, m.index);
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
    const edges: any[] = [];
    const seenEdges = new Set<string>();

    const addEdge = (fromId: string, toLabel: string, type: any) => {
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
      const className = m[1];
      const basesStr = m[2];
      if (basesStr) {
        const bases = basesStr.split(',').map((b) => b.trim().split('[')[0].trim());
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

export const pack: LanguagePack = {
  metadata: {
    name: 'python',
    version: '1.0.0',
    fileExtensions: ['.py'],
  },
  supportedLanguages: ['python', 'py', '.py'],
  fileExtensions: ['.py'],
  parserName: 'tree-sitter-python',
  repograph: pythonRepograph,
  astQueries: {
    functions: `
      (function_definition) @func
    `,
    classes: `
      (class_definition) @class
    `,
    imports: `
      (import_statement) @import
      (import_from_statement) @import
    `,
  },
  regexPatterns: {
    commentDetection: /#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''/g,
    importExtraction: /^(?:import\s+\w+|from\s+\w+\s+import\s+[\w\s,()]+)/gm,
  },
  rules: {
    comment: { action: 'strip' },
    import: { action: 'shrink' },
  },
  squeezer: {
    bodyPlaceholder: '\n    ...',
    bodyPatterns: [
      {
        pattern: /^([ \t]*)((?:async\s+)?def\s+\w+\s*\([^)]*\)\s*(?:->\s*[^\n:]+)?\s*:)(?:\s*\n)(?:(?:\1[ \t]+[^\n]*\n?)|\s*\n)*/gm,
        replacement: '$1$2\n$1    ...',
      },
      {
        pattern: /^([ \t]*)(class\s+\w+(?:\([^)]*\))?\s*:)(?:\s*\n)(?:(?:\1[ \t]+[^\n]*\n?)|\s*\n)*/gm,
        replacement: '$1$2\n$1    ...',
      },
    ],
    privateBodyPatterns: [
      {
        pattern: /^([ \t]*)((?:async\s+)?def\s+_\w+\s*\([^)]*\)\s*(?:->\s*[^\n:]+)?\s*:)(?:\s*\n)(?:(?:\1[ \t]+[^\n]*\n?)|\s*\n)*/gm,
        replacement: '$1$2\n$1    ...',
      },
    ],
    importStartRegex: /^\s*(import|from)\s+/,
    importEndRegex: /\)/,
    wildcardRules: [
      {
        pattern: /from\s+(\S+)\s+import\s+/,
        replacement: 'import $1',
        action: 'replace',
      },
      {
        pattern: /import\s+(\w+),/,
        replacement: 'import $1',
        action: 'replace',
      },
    ],
    wildcardFallbackAction: 'keep',
  },
  lintFix: {
    commands: [
      ['ruff', 'check', '--fix'],
      ['ruff', 'format'],
      ['autopep8', '--in-place'],
      ['black'],
    ],
  },
};

export default pack;
