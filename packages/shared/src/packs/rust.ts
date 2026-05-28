import type { LanguagePack } from '../types/language-pack.js';

const RUST_USE_RE = /^\s*use\s+([\w:]+)(?:::\{([^}]+)\})?;/gm;
const RUST_STRUCT_RE = /(?:^|\n)\s*(?:pub(?:\([^)]+\))?\s+)?(?:struct|enum|trait|union)\s+(\w+)/g;
const RUST_FN_RE = /(?:^|\n)\s*(?:pub(?:\([^)]+\))?\s+)?(?:const\s+|async\s+|unsafe\s+|extern\s+)*fn\s+(\w+)/g;
const RUST_IMPL_RE = /(?:^|\n)\s*impl(?:\s*<[^>]+>)?\s+(?:(\w+)\s+for\s+)?(\w+)/g;

const rustRepograph = {
  extractImports(content: string, filePath: string) {
    const results: any[] = [];
    const seen = new Set<string>();
    RUST_USE_RE.lastIndex = 0;
    let match;
    while ((match = RUST_USE_RE.exec(content)) !== null) {
      const base = match[1];
      const subnames = match[2];
      if (subnames) {
        const names = subnames.split(',').map((n) => n.trim());
        const key = `${base}:{${names.join(',')}}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ source: base, names });
        }
      } else {
        if (!seen.has(base)) {
          seen.add(base);
          results.push({ source: base, names: [] });
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
      { re: RUST_STRUCT_RE, type: 'class' as const },
      { re: RUST_FN_RE, type: 'function' as const },
    ];

    for (const pat of patterns) {
      pat.re.lastIndex = 0;
      let m;
      while ((m = pat.re.exec(content)) !== null) {
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        // Let's use custom lines pos finder (inlined or helper)
        const pos = { line: 1, column: 1 };
        // Simple inline finder for Rust to keep imports independent
        let offset = m.index;
        const line = 1;
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

    RUST_IMPL_RE.lastIndex = 0;
    let m;
    while ((m = RUST_IMPL_RE.exec(content)) !== null) {
      const traitName = m[1];
      const structName = m[2];
      if (structName) {
        const fromId = `sym:${structName}@${filePath}`;
        if (traitName) {
          addEdge(fromId, traitName, 'implements');
        }
      }
    }
    return edges;
  },
};

export const pack: LanguagePack = {
  metadata: {
    name: 'rust',
    version: '1.0.0',
    fileExtensions: ['.rs'],
  },
  supportedLanguages: ['rust', 'rs', '.rs'],
  fileExtensions: ['.rs'],
  parserName: 'tree-sitter-rust',
  repograph: rustRepograph,
  astQueries: {
    functions: `
      (function_item) @func
    `,
    classes: `
      (struct_item) @class
      (enum_item) @class
      (trait_item) @class
      (union_item) @class
    `,
    imports: `
      (use_declaration) @import
    `,
  },
  regexPatterns: {
    commentDetection: /\/\/.*|\/\*[\s\S]*?\*\//g,
    importExtraction: /^\s*use\s+[\s\S]*?;/gm,
  },
  rules: {
    comment: { action: 'strip' },
    import: { action: 'shrink' },
  },
  squeezer: {
    bodyPlaceholder: '{\n    todo!()\n}',
    bodyPatterns: [
      {
        pattern: /(fn\s+\w+\s*(?:<[^>]+>)?\s*\([^)]*\)\s*(?:->\s*[^{]+)?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
    ],
    privateBodyPatterns: [
      {
        pattern: /(?<!pub\s+)(fn\s+\w+\s*(?:<[^>]+>)?\s*\([^)]*\)\s*(?:->\s*[^{]+)?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
    ],
    importStartRegex: /^\s*use\s+/,
    importEndRegex: /;/,
    wildcardFallbackAction: 'keep',
  },
  lintFix: {
    commands: [
      ['rustfmt'],
    ],
  },
};

export default pack;
