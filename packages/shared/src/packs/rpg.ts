import type { LanguagePack } from '../types/language-pack.js';
import { posFromIndex } from './utils.js';

const RPG_PROC_FREE_RE = /(?:^|\n)\s*dcl-proc\s+(\w+)/gi;
const RPG_PROC_FIXED_RE = /(?:^|\n).{5}P\s+([\w#$@]+)\s+B/gi;
const RPG_DCL_FREE_RE = /(?:^|\n)\s*(?:dcl-s|dcl-ds|dcl-c)\s+(\w+)/gi;
const RPG_DCL_FIXED_RE = /(?:^|\n).{5}D\s+([\w#$@]+)/gi;
const RPG_IMPORT_RE = /^\s*\/copy\s+([\w./,-]+)|^\s*\/include\s+([\w./,-]+)/gim;

const rpgRepograph = {
  extractImports(content: string, filePath: string) {
    const results: any[] = [];
    const seen = new Set<string>();

    RPG_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RPG_IMPORT_RE.exec(content)) !== null) {
      const source = match[1] || match[2];
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
      { re: RPG_PROC_FREE_RE, type: 'function' as const, nameGroup: 1 },
      { re: RPG_PROC_FIXED_RE, type: 'function' as const, nameGroup: 1 },
      { re: RPG_DCL_FREE_RE, type: 'variable' as const, nameGroup: 1 },
      { re: RPG_DCL_FIXED_RE, type: 'variable' as const, nameGroup: 1 },
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
    let currentProc: string | null = null;

    const procStartRe = /(?:dcl-proc\s+(\w+)|.{5}P\s+([\w#$@]+)\s+B)/i;
    const procEndRe = /(?:end-proc|.{5}P\s+([\w#$@]+)\s+E)/i;
    const callRe = /(?:callp\s+(\w+)|exsr\s+(\w+))/gi;

    for (const line of lines) {
      const startMatch = procStartRe.exec(line);
      if (startMatch) {
        currentProc = startMatch[1] || startMatch[2];
        continue;
      }

      const endMatch = procEndRe.exec(line);
      if (endMatch) {
        currentProc = null;
        continue;
      }

      if (currentProc) {
        callRe.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = callRe.exec(line)) !== null) {
          const target = match[1] || match[2];
          if (target && target.toLowerCase() !== currentProc.toLowerCase()) {
            const fromId = `sym:${currentProc}@${filePath}`;
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
    name: 'rpg',
    version: '1.0.0',
    fileExtensions: ['.rpg', '.rpgle', '.sqlrpgle'],
  },
  supportedLanguages: ['rpg', 'rpgle', 'sqlrpgle', '.rpg', '.rpgle', '.sqlrpgle'],
  fileExtensions: ['.rpg', '.rpgle', '.sqlrpgle'],
  parserName: 'rpg-parser',
  repograph: rpgRepograph,
  regexPatterns: {
    commentDetection: /^.{6}\*[^\n]*|\/\*[\s\S]*?\*\/|\/\/.*|--.*/gm,
    importExtraction: /^\s*\/copy\s+\S+|^\s*\/include\s+\S+/gim,
  },
  rules: {
    comment: { action: 'strip' },
    import: { action: 'shrink' },
  },
  squeezer: {
    bodyPlaceholder: '\n    ...\n',
    bodyPatterns: [
      {
        pattern: /(dcl-proc\s+\w+;?)([\s\S]*?)(end-proc;?)/gi,
        replacement: '$1\n    ...\n$3',
      },
      {
        pattern: /(P\s+\w+\s+B)([\s\S]*?)(P\s+\w*\s+E)/gi,
        replacement: '$1\n    ...\n$3',
      },
    ],
    importStartRegex: /^\s*\/copy\s+|^\s*\/include\s+/i,
    importEndRegex: /\n/,
    wildcardFallbackAction: 'keep',
  },
  solidEnforcer: {
    classRegex: /(?:dcl-proc\s+(\w+)|.{5}P\s+([\w#$@]+)\s+B)/gi,
    interfaceRegex: /dcl-pr\s+(\w+)/gi,
    newInstantiationRegex: /(?:callp\s+(\w+)|exsr\s+(\w+))/gi,
  },
  lintFix: {
    commands: [
      ['rpgle-format', '--write'],
      ['rpgle-lint', '--fix'],
    ],
  },
};

export default pack;
