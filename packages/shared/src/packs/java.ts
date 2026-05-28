import type { LanguagePack } from '../types/language-pack.js';

const JAVA_IMPORT_RE = /^\s*import\s+(?:static\s+)?([\w.]+);/gm;
const JAVA_CLASS_RE = /(?:^|\n)\s*(?:(?:public|private|protected|abstract|static|final)\s+)*(class|interface|enum|record)\s+(\w+)/g;
const JAVA_METHOD_RE = /(?:^|\n)\s*(?:(?:public|private|protected|static|final|synchronized|abstract|default)\s+)+(?!class|interface|enum|record|new|return)([\w<>]+)\s+(\w+)\s*\(([^)]*)\)/g;
const JAVA_INHERITANCE_RE = /(?:class|interface)\s+(\w+)(?:\s+extends\s+([\w.]+))?(?:\s+implements\s+([\w.,\s]+))?/g;

const javaRepograph = {
  extractImports(content: string, filePath: string) {
    const results: any[] = [];
    const seen = new Set<string>();
    JAVA_IMPORT_RE.lastIndex = 0;
    let match;
    while ((match = JAVA_IMPORT_RE.exec(content)) !== null) {
      const source = match[1];
      if (!seen.has(source)) {
        seen.add(source);
        results.push({ source, names: [] });
      }
    }
    return results;
  },

  extractDeclarations(content: string, filePath: string) {
    const symbols: any[] = [];
    const lines = content.split('\n');
    const seen = new Set<string>();

    const patterns = [
      { re: JAVA_CLASS_RE, type: 'class' as const, nameGroup: 2 },
      { re: JAVA_METHOD_RE, type: 'function' as const, nameGroup: 2 },
    ];

    for (const patternsItem of patterns) {
      patternsItem.re.lastIndex = 0;
      let m;
      while ((m = patternsItem.re.exec(content)) !== null) {
        const name = m[patternsItem.nameGroup];
        if (seen.has(name)) continue;
        seen.add(name);
        const pos = { line: 1, column: 1 };
        let offset = m.index;
        for (let i = 0; i < lines.length; i++) {
          const len = lines[i].length + 1;
          if (offset < len) {
            pos.line = i + 1;
            pos.column = offset + 1;
            break;
          }
          offset -= len;
        }

        symbols.push({
          name,
          type: patternsItem.type,
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

    JAVA_INHERITANCE_RE.lastIndex = 0;
    let m;
    while ((m = JAVA_INHERITANCE_RE.exec(content)) !== null) {
      const subName = m[1];
      const extendsTarget = m[2];
      const implementsTargets = m[3];
      const fromId = `sym:${subName}@${filePath}`;

      if (extendsTarget) {
        addEdge(fromId, extendsTarget.split('.').pop()!, 'extends');
      }
      if (implementsTargets) {
        const targets = implementsTargets.split(',').map((t) => t.trim().split('.').pop()!);
        for (const target of targets) {
          if (target) {
            addEdge(fromId, target, 'implements');
          }
        }
      }
    }
    return edges;
  },
};

export const pack: LanguagePack = {
  metadata: {
    name: 'java',
    version: '1.0.0',
    fileExtensions: ['.java'],
  },
  supportedLanguages: ['java', '.java'],
  fileExtensions: ['.java'],
  parserName: 'tree-sitter-java',
  repograph: javaRepograph,
  astQueries: {
    functions: `
      (method_declaration) @func
      (constructor_declaration) @func
    `,
    classes: `
      (class_declaration) @class
      (interface_declaration) @class
      (enum_declaration) @class
      (record_declaration) @class
    `,
    imports: `
      (import_declaration) @import
    `,
  },
  regexPatterns: {
    commentDetection: /\/\/.*|\/\*[\s\S]*?\*\//g,
    importExtraction: /^\s*import\s+[\s\S]*?;/gm,
  },
  rules: {
    comment: { action: 'strip' },
    import: { action: 'shrink' },
  },
  squeezer: {
    bodyPlaceholder: '{ /* ... */ }',
    bodyPatterns: [
      {
        pattern: /(\b(?:public|private|protected|static|final|synchronized|abstract|default)\s+[\w<>]+\s+\w+\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
    ],
    privateBodyPatterns: [
      {
        pattern: /(\b(?:private|protected)\s+[\w<>]+\s+\w+\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
    ],
    importStartRegex: /^\s*import\s+/,
    importEndRegex: /;/,
    wildcardFallbackAction: 'keep',
  },
  lintFix: {
    commands: [
      ['google-java-format', '-i'],
    ],
  },
};

export default pack;
