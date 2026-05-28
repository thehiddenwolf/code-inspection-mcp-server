import type { LanguagePack } from '../types/language-pack.js';
import { posFromIndex } from './utils.js';

const CS_USING_RE = /^\s*using\s+(?:static\s+)?(?:([\w@]+)\s*=\s*)?([\w.]+);/gm;
const CS_CLASS_RE = /(?:^|\n)\s*(?:(?:public|private|protected|internal|static|sealed|abstract|partial)\s+)*class\s+(\w+)/g;
const CS_INTERFACE_RE = /(?:^|\n)\s*(?:(?:public|private|protected|internal|partial)\s+)*interface\s+(\w+)/g;
const CS_STRUCT_RE = /(?:^|\n)\s*(?:(?:public|private|protected|internal|readonly|partial|ref)\s+)*struct\s+(\w+)/g;
const CS_RECORD_RE = /(?:^|\n)\s*(?:(?:public|private|protected|internal|partial)\s+)*record\s+(?:class\s+|struct\s+)?(\w+)/g;
const CS_ENUM_RE = /(?:^|\n)\s*(?:(?:public|private|protected|internal)\s+)*enum\s+(\w+)/g;
const CS_METHOD_RE = /(?:^|\n)\s*(?:(?:public|private|protected|internal|static|async|virtual|override|abstract|sealed|partial)\s+)+(?!class|interface|struct|record|enum|namespace|new|return|if|while|for|foreach|switch|using|lock|catch)([\w.<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)/g;
const CS_INHERITANCE_RE = /(?:class|interface|struct|record)\s+(\w+)(?:<[^>]*>)?\s*:\s*([^{;]+?)(?=\s*(?:\{|;|\bwhere\b))/g;

const csharpRepograph = {
  extractImports(content: string, filePath: string) {
    const results: any[] = [];
    const seen = new Set<string>();

    CS_USING_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CS_USING_RE.exec(content)) !== null) {
      const alias = match[1];
      const source = match[2];
      const key = `${source}:${alias || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          source,
          names: alias ? [alias] : [],
        });
      }
    }
    return results;
  },

  extractDeclarations(content: string, filePath: string) {
    const symbols: any[] = [];
    const lines = content.split('\n');
    const seen = new Set<string>();

    const patterns = [
      { re: CS_CLASS_RE, type: 'class' as const, nameGroup: 1 },
      { re: CS_INTERFACE_RE, type: 'interface' as const, nameGroup: 1 },
      { re: CS_STRUCT_RE, type: 'class' as const, nameGroup: 1 },
      { re: CS_RECORD_RE, type: 'class' as const, nameGroup: 1 },
      { re: CS_ENUM_RE, type: 'class' as const, nameGroup: 1 },
      { re: CS_METHOD_RE, type: 'function' as const, nameGroup: 2 },
    ];

    for (const pat of patterns) {
      pat.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.re.exec(content)) !== null) {
        const name = m[pat.nameGroup];
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

    CS_INHERITANCE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CS_INHERITANCE_RE.exec(content)) !== null) {
      const subName = m[1];
      const targetsStr = m[2];
      const targets = targetsStr.split(',').map((t) => t.trim().split('<')[0].trim());
      const fromId = `sym:${subName}@${filePath}`;

      for (const target of targets) {
        if (!target) continue;
        const isInterface = /^I[A-Z]/.test(target);
        const type = isInterface ? ('implements' as const) : ('extends' as const);
        addEdge(fromId, target, type);
      }
    }
    return edges;
  },
};

export const pack: LanguagePack = {
  metadata: {
    name: 'csharp',
    version: '1.0.0',
    fileExtensions: ['.cs'],
  },
  supportedLanguages: ['csharp', 'cs', '.cs'],
  fileExtensions: ['.cs'],
  parserName: 'tree-sitter-c-sharp',
  repograph: csharpRepograph,
  astQueries: {
    functions: `
      (method_declaration) @func
      (constructor_declaration) @func
      (destructor_declaration) @func
      (local_function_statement) @func
    `,
    classes: `
      (class_declaration) @class
      (interface_declaration) @class
      (struct_declaration) @class
      (record_declaration) @class
      (enum_declaration) @class
    `,
    imports: `
      (using_directive) @import
    `,
  },
  regexPatterns: {
    commentDetection: /\/\/.*|\/\*[\s\S]*?\*\//g,
    importExtraction: /^using\s+[\s\S]*?;/gm,
  },
  rules: {
    comment: { action: 'strip' },
    import: { action: 'shrink' },
  },
  squeezer: {
    bodyPlaceholder: '{ /* ... */ }',
    bodyPatterns: [
      {
        pattern: /(\b(?:public|private|protected|internal|static|async|override|virtual|abstract|partial)\s+[\w<>]+\s+\w+\s*\([^)]*\)\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
    ],
    privateBodyPatterns: [
      {
        pattern: /(\b(?:private|protected)\s+[\w<>]+\s+\w+\s*\([^)]*\)\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
    ],
    importStartRegex: /^\s*using\s+/,
    importEndRegex: /;/,
    wildcardFallbackAction: 'keep',
  },
  lintFix: {
    commands: [
      ['dotnet', 'format', '--include'],
      ['dotnet-format'],
    ],
  },
};

export default pack;
