import type { LanguagePack } from '../types/language-pack.js';
import { posFromIndex } from './utils.js';

const PS_FUNC_RE = /(?:^|\n)\s*function\s+([\w-]+)/gi;
const PS_IMPORT_RE = /^\s*(?:Import-Module|\.)\s+['"]?([\w.\\/-]+)['"]?/gim;

const powershellRepograph = {
  extractImports(content: string, filePath: string) {
    const results: any[] = [];
    const seen = new Set<string>();

    PS_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PS_IMPORT_RE.exec(content)) !== null) {
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

    PS_FUNC_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PS_FUNC_RE.exec(content)) !== null) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const pos = posFromIndex(content, lines, m.index);
      symbols.push({
        name,
        type: 'function' as const,
        exported: true,
        line: pos.line,
        column: pos.column,
        filePath,
      });
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

    const funcStartRe = /^\s*function\s+([\w-]+)/i;
    const funcEndRe = /^\s*\}\s*$/i;
    const callRe = /\b([\w-]+)\b/gi;

    for (const line of lines) {
      const startMatch = funcStartRe.exec(line);
      if (startMatch) {
        currentFunc = startMatch[1];
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
            !/^(if|else|elseif|switch|foreach|for|while|do|until|filter|class|enum|interface|return|exit|write-host|write-output|out-null)$/i.test(target)
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
    name: 'powershell',
    version: '1.0.0',
    fileExtensions: ['.ps1', '.psm1', '.psd1'],
  },
  supportedLanguages: ['powershell', 'powershell-core', 'ps1', 'psm1', '.ps1', '.psm1', '.psd1'],
  fileExtensions: ['.ps1', '.psm1', '.psd1'],
  parserName: 'powershell-parser',
  repograph: powershellRepograph,
  regexPatterns: {
    commentDetection: /<#[\s\S]*?#>|#[^\n]*/g,
    importExtraction: /^\s*(?:Import-Module|\.)\s+\S+/gim,
  },
  rules: {
    comment: { action: 'strip' },
    import: { action: 'shrink' },
  },
  squeezer: {
    bodyPlaceholder: '{ \n    ...\n }',
    bodyPatterns: [
      {
        pattern: /(function\s+[\w-]+\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{\n    ...\n}',
      },
    ],
    importStartRegex: /^\s*(?:Import-Module|\.)\s+/,
    importEndRegex: /\n/,
    wildcardFallbackAction: 'keep',
  },
  solidEnforcer: {
    classRegex: /class\s+(\w+)/gi,
    interfaceRegex: /interface\s+(\w+)/gi,
  },
  lintFix: {
    commands: [
      ['pwsh', '-Command', 'Invoke-Formatter'],
      ['powershell', '-Command', 'Invoke-Formatter'],
    ],
  },
};

export default pack;
