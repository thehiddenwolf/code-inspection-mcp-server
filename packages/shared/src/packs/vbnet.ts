import type { LanguagePack } from '../types/language-pack.js';
import { posFromIndex } from './utils.js';

const VB_IMPORT_RE = /^\s*Imports\s+(?:([\w@]+)\s*=\s*)?([\w.]+)/gim;
const VB_CLASS_RE = /(?:^|\n)\s*(?:(?:Public|Private|Protected|Friend|MustInherit|NotInheritable|Static|Shared|Partial)\s+)*Class\s+(\w+)/gi;
const VB_INTERFACE_RE = /(?:^|\n)\s*(?:(?:Public|Private|Protected|Friend|Partial)\s+)*Interface\s+(\w+)/gi;
const VB_STRUCT_RE = /(?:^|\n)\s*(?:(?:Public|Private|Protected|Friend|Partial)\s+)*Structure\s+(\w+)/gi;
const VB_MODULE_RE = /(?:^|\n)\s*(?:(?:Public|Private|Protected|Friend)\s+)*Module\s+(\w+)/gi;
const VB_ENUM_RE = /(?:^|\n)\s*(?:(?:Public|Private|Protected|Friend)\s+)*Enum\s+(\w+)/gi;
const VB_METHOD_RE = /(?:^|\n)\s*(?:(?:Public|Private|Protected|Friend|Shared|Overridable|Overrides|MustOverride|Async)\s+)*(?:Sub|Function)\s+(\w+)\s*\(([^)]*)\)/gi;

const vbnetRepograph = {
  extractImports(content: string, filePath: string) {
    const MathResults: any[] = [];
    const seen = new Set<string>();

    VB_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = VB_IMPORT_RE.exec(content)) !== null) {
      const alias = match[1];
      const source = match[2];
      const key = `${source}:${alias || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        MathResults.push({
          source,
          names: alias ? [alias] : [],
        });
      }
    }
    return MathResults;
  },

  extractDeclarations(content: string, filePath: string) {
    const symbols: any[] = [];
    const lines = content.split('\n');
    const seen = new Set<string>();

    const patterns = [
      { re: VB_CLASS_RE, type: 'class' as const, nameGroup: 1 },
      { re: VB_INTERFACE_RE, type: 'interface' as const, nameGroup: 1 },
      { re: VB_STRUCT_RE, type: 'class' as const, nameGroup: 1 },
      { re: VB_MODULE_RE, type: 'class' as const, nameGroup: 1 },
      { re: VB_ENUM_RE, type: 'class' as const, nameGroup: 1 },
      { re: VB_METHOD_RE, type: 'function' as const, nameGroup: 1 },
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

    const lines = content.split(/\r?\n/);
    let currentTypeName: string | null = null;

    const typeStartRe = /^\s*(?:(?:Public|Private|Protected|Friend|MustInherit|NotInheritable|Static|Shared|Partial)\s+)*(Class|Interface|Structure|Module)\s+(\w+)/i;
    const typeEndRe = /^\s*End\s+(Class|Interface|Structure|Module)/i;
    const inheritsRe = /^\s*Inherits\s+([\w.]+)/i;
    const implementsRe = /^\s*Implements\s+(.+)/i;

    for (const line of lines) {
      const typeStartMatch = typeStartRe.exec(line);
      if (typeStartMatch) {
        currentTypeName = typeStartMatch[2]!;
        continue;
      }

      const typeEndMatch = typeEndRe.exec(line);
      if (typeEndMatch) {
        currentTypeName = null;
        continue;
      }

      if (!currentTypeName) continue;

      const inheritsMatch = inheritsRe.exec(line);
      if (inheritsMatch) {
        const parentName = inheritsMatch[1].trim().split('<')[0].trim();
        const fromId = `sym:${currentTypeName}@${filePath}`;
        addEdge(fromId, parentName, 'extends');
        continue;
      }

      const implementsMatch = implementsRe.exec(line);
      if (implementsMatch) {
        const targets = implementsMatch[1].split(',').map((t) => t.trim().split('<')[0].trim());
        const fromId = `sym:${currentTypeName}@${filePath}`;
        for (const target of targets) {
          if (target) {
            addEdge(fromId, target, 'implements');
          }
        }
        continue;
      }
    }

    return edges;
  },
};

export const pack: LanguagePack = {
  metadata: {
    name: 'vbnet',
    version: '1.0.0',
    fileExtensions: ['.vb'],
  },
  supportedLanguages: ['vbnet', 'vb', '.vb'],
  fileExtensions: ['.vb'],
  parserName: 'tree-sitter-vbnet',
  repograph: vbnetRepograph,
  astQueries: {
    functions: `
      (method_declaration) @func
    `,
  },
  regexPatterns: {
    commentDetection: /'[^\n]*/g,
    importExtraction: /^Imports\s+[\w.]+/gm,
  },
  rules: {
    comment: { action: 'strip' },
    import: { action: 'shrink' },
  },
  squeezer: {
    bodyPlaceholder: '\n    ...\n',
    bodyPatterns: [
      {
        pattern: /(Sub\s+\w+\s*\([^)]*\))([\s\S]*?)(End\s+Sub)/gi,
        replacement: '$1\n    ...\n$3',
      },
      {
        pattern: /(Function\s+\w+\s*\([^)]*\)(?:\s+As\s+\w+)?)([\s\S]*?)(End\s+Function)/gi,
        replacement: '$1\n    ...\n$3',
      },
      {
        pattern: /(Class\s+\w+)([\s\S]*?)(End\s+Class)/gi,
        replacement: '$1\n    ...\n$3',
      },
    ],
    importStartRegex: /^\s*Imports\s+/,
    importEndRegex: /\n/,
    wildcardFallbackAction: 'keep',
  },
};

export default pack;
