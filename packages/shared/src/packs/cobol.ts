import type { LanguagePack } from '../types/language-pack.js';
import { posFromIndex } from './utils.js';

const COBOL_PROGRAM_RE = /PROGRAM-ID\.\s+([\w-]+)/gi;
const COBOL_PARAGRAPH_RE = /^[ \t]{6}[ \t]([A-Za-z0-9-]+)\.(?:\s|$)/gm;
const COBOL_IMPORT_RE = /^\s*COPY\s+['"]?([\w.-]+)['"]?/gim;

const cobolRepograph = {
  extractImports(content: string, filePath: string) {
    const results: any[] = [];
    const seen = new Set<string>();

    COBOL_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = COBOL_IMPORT_RE.exec(content)) !== null) {
      const source = match[1];
      if (source && !seen.has(source)) {
        seen.add(source);
        results.push({
          source,
          names: [],
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
      { re: COBOL_PROGRAM_RE, type: 'class' as const, nameGroup: 1 },
      { re: COBOL_PARAGRAPH_RE, type: 'function' as const, nameGroup: 1 },
    ];

    const reserved = new Set([
      'identification',
      'program-id',
      'environment',
      'data',
      'procedure',
      'division',
      'section',
      'working-storage',
      'local-storage',
      'linkage',
      'file-control',
      'file',
      'configuration',
      'input-output'
    ]);

    for (const pat of patterns) {
      pat.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.re.exec(content)) !== null) {
        const name = m[pat.nameGroup];
        if (reserved.has(name.toLowerCase())) continue;
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
    let currentScope: string | null = null;

    const programStartRe = /PROGRAM-ID\.\s+([\w-]+)/i;
    const paragraphRe = /^[ \t]{6}[ \t]([A-Za-z0-9-]+)\.(?:\s|$)/i;
    const callRe = /(?:CALL|PERFORM)\s+['"]?([\w-]+)['"]?/gi;

    for (const line of lines) {
      const progMatch = programStartRe.exec(line);
      if (progMatch) {
        currentScope = progMatch[1];
        continue;
      }

      const paraMatch = paragraphRe.exec(line);
      if (paraMatch) {
        currentScope = paraMatch[1];
        continue;
      }

      if (currentScope) {
        callRe.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = callRe.exec(line)) !== null) {
          const target = match[1];
          if (target && target.toLowerCase() !== currentScope.toLowerCase()) {
            const fromId = `sym:${currentScope}@${filePath}`;
            addEdge(fromId, target, 'calls');
          }
        }
      }
    }

    return edges;
  },
};

export const pack: LanguagePack = {
  metadata: {
    name: 'cobol',
    version: '1.0.0',
    fileExtensions: ['.cbl', '.cob', '.cpy'],
  },
  supportedLanguages: ['cobol', 'cob', 'cbl', '.cobol', '.cob', '.cbl', '.cpy'],
  fileExtensions: ['.cbl', '.cob', '.cpy'],
  parserName: 'cobol-parser',
  repograph: cobolRepograph,
  regexPatterns: {
    commentDetection: /^.{6}[*/][^\n]*|\*>.*/gm,
    importExtraction: /^\s*COPY\s+\S+/gim,
  },
  rules: {
    comment: { action: 'strip' },
    import: { action: 'shrink' },
  },
  solidEnforcer: {
    classRegex: /PROGRAM-ID\.\s+([\w-]+)/gi,
    interfaceRegex: /ENTRY\s+['"]?([\w-]+)['"]?/gi,
  },
  lintFix: {
    commands: [
      ['cobol-lint', '--fix'],
      ['gcobol', '-fsyntax-only'],
    ],
  },
};

export default pack;
