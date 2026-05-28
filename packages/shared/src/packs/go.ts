import type { LanguagePack } from '../types/language-pack.js';
import { posFromIndex } from './utils.js';

const GO_IMPORT_SINGLE_RE = /import\s+(?:[\w.]+\s+)?["']([^"']+)["']/g;
const GO_IMPORT_BLOCK_RE = /import\s*\(([\s\S]*?)\)/g;
const GO_FUNC_RE = /(?:^|\n)\s*func\s+(?:\([^)]+\)\s+)?(\w+)/g;
const GO_TYPE_RE = /(?:^|\n)\s*type\s+(\w+)\s+(?:struct|interface)/g;

const goRepograph = {
  extractImports(content: string, filePath: string) {
    const results: any[] = [];
    const seen = new Set<string>();

    GO_IMPORT_SINGLE_RE.lastIndex = 0;
    let match;
    while ((match = GO_IMPORT_SINGLE_RE.exec(content)) !== null) {
      const source = match[1];
      if (!seen.has(source)) {
        seen.add(source);
        results.push({ source, names: [] });
      }
    }

    GO_IMPORT_BLOCK_RE.lastIndex = 0;
    while ((match = GO_IMPORT_BLOCK_RE.exec(content)) !== null) {
      const lines = match[1].split('\n');
      for (const line of lines) {
        const lineMatch = /["']([^"']+)["']/.exec(line);
        if (lineMatch) {
          const source = lineMatch[1];
          if (!seen.has(source)) {
            seen.add(source);
            results.push({ source, names: [] });
          }
        }
      }
    }
    return results;
  },

  extractDeclarations(content: string, filePath: string) {
    const symbols: any[] = [];
    const lines = content.split('\n');
    const seen = new Set<string>();

    const patterns = [
      { re: GO_FUNC_RE, type: 'function' as const },
      { re: GO_TYPE_RE, type: 'class' as const },
    ];

    for (const pat of patterns) {
      pat.re.lastIndex = 0;
      let m;
      while ((m = pat.re.exec(content)) !== null) {
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        const pos = posFromIndex(content, lines, m.index);
        symbols.push({
          name,
          type: pat.type,
          exported: /^[A-Z]/.test(name),
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

    const structRe = /type\s+(\w+)\s+struct\s*\{([\s\S]*?)\}/g;
    structRe.lastIndex = 0;
    let m;
    while ((m = structRe.exec(content)) !== null) {
      const structName = m[1];
      const body = m[2];
      const lines = body.split('\n');
      const fromId = `sym:${structName}@${filePath}`;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.includes('/*')) continue;
        const embedMatch = /^\s*([A-Z]\w*(?:\.[A-Z]\w*)?)\s*(?:`[^`]*`)?\s*$/.exec(trimmed);
        if (embedMatch) {
          const parentName = embedMatch[1].split('.').pop()!;
          addEdge(fromId, parentName, 'extends');
        }
      }
    }
    return edges;
  },
};

export const pack: LanguagePack = {
  metadata: {
    name: 'go',
    version: '1.0.0',
    fileExtensions: ['.go'],
  },
  supportedLanguages: ['go', '.go'],
  fileExtensions: ['.go'],
  parserName: 'tree-sitter-go',
  repograph: goRepograph,
  astQueries: {
    functions: `
      (function_declaration) @func
      (method_declaration) @func
    `,
    classes: `
      (type_declaration) @class
    `,
    imports: `
      (import_declaration) @import
    `,
  },
  regexPatterns: {
    commentDetection: /\/\/.*|\/\*[\s\S]*?\*\//g,
    importExtraction: /^import\s+(?:\([\s\S]*?\)|"[^"]*")/gm,
  },
  rules: {
    comment: { action: 'strip' },
    import: { action: 'shrink' },
  },
  squeezer: {
    bodyPlaceholder: '{ /* ... */ }',
    bodyPatterns: [
      {
        pattern: /(func\s+(?:\w+\s+)?\w+\s*\([^)]*\)\s*(?:\w+(?:<[^>]*>)?)?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
    ],
    privateBodyPatterns: [
      {
        pattern: /(func\s+[a-z]\w*\s*\([^)]*\)\s*(?:\w+(?:<[^>]*>)?)?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
    ],
    importStartRegex: /^\s*import\s+/,
    importEndRegex: /\)/,
    wildcardFallbackAction: 'keep',
  },
  lintFix: {
    commands: [
      ['goimports', '-w'],
      ['gofmt', '-w'],
    ],
  },
};

export default pack;
