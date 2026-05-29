import type { LanguagePack } from '../types/language-pack.js';
import { posFromIndex } from './utils.js';

const BASH_FUNC1_RE = /(?:^|\n)\s*function\s+(\w+)\s*\{/gi;
const BASH_FUNC2_RE = /(?:^|\n)\s*(?:function\s+)?(\w+)\s*\(\s*\)\s*\{/gi;
const BASH_IMPORT_RE = /^\s*(?:source|\.)\s+['"]?([\w./~-]+)['"]?/gim;

const bashRepograph = {
  extractImports(content: string, filePath: string) {
    const results: any[] = [];
    const seen = new Set<string>();

    BASH_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BASH_IMPORT_RE.exec(content)) !== null) {
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
      { re: BASH_FUNC1_RE, type: 'function' as const, nameGroup: 1 },
      { re: BASH_FUNC2_RE, type: 'function' as const, nameGroup: 1 },
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
    let currentFunc: string | null = null;

    const funcStartRe = /(?:function\s+(\w+)|(\w+)\s*\(\s*\)\s*\{)/i;
    const funcEndRe = /^\s*\}\s*$/i;
    const callRe = /\b([a-zA-Z_]\w*)\s*(?:\(|;|\n|$)/gi;

    for (const line of lines) {
      const startMatch = funcStartRe.exec(line);
      if (startMatch) {
        currentFunc = startMatch[1] || startMatch[2];
        continue;
      }

      const endMatch = funcEndRe.exec(line);
      if (endMatch) {
        currentFunc = null;
        continue;
      }

      if (currentFunc) {
        callRe.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = callRe.exec(line)) !== null) {
          const target = match[1];
          if (
            target &&
            target.toLowerCase() !== currentFunc.toLowerCase() &&
            !/^(if|then|else|elif|fi|case|esac|for|while|do|done|in|local|return|exit|echo|printf|cd|pwd|ls|grep|sed|awk)$/.test(target)
          ) {
            const fromId = `sym:${currentFunc}@${filePath}`;
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
    name: 'bash',
    version: '1.0.0',
    fileExtensions: ['.sh', '.bash', '.zsh'],
  },
  supportedLanguages: ['bash', 'sh', 'shell', 'zsh', '.sh', '.bash', '.zsh'],
  fileExtensions: ['.sh', '.bash', '.zsh'],
  parserName: 'bash-parser',
  repograph: bashRepograph,
  regexPatterns: {
    commentDetection: /#(?!!)[^\n]*/g,
    importExtraction: /^\s*(?:source|\.)\s+\S+/gim,
  },
  rules: {
    comment: { action: 'strip' },
    import: { action: 'shrink' },
  },
  squeezer: {
    bodyPlaceholder: '{ \n    ...\n }',
    bodyPatterns: [
      {
        pattern: /(function\s+\w+\s*(?:\(\))?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{\n    ...\n}',
      },
      {
        pattern: /(\w+\s*\(\s*\)\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{\n    ...\n}',
      },
    ],
    importStartRegex: /^\s*(?:source|\.)\s+/,
    importEndRegex: /\n/,
    wildcardFallbackAction: 'keep',
  },
  lintFix: {
    commands: [
      ['shfmt', '-w'],
      ['shellcheck', '-x'],
    ],
  },
};

export default pack;
