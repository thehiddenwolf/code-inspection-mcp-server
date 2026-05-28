import type { LanguagePack } from '../types/language-pack.js';
import { cleanSqlName, posFromIndex } from './utils.js';

const SQL_IMPORT_RE = /^\s*(?:\\i|source)\s+['"]?([\w./-]+)['"]?/gim;
const SQL_VIEW_RE = /(?:^|\n)\s*CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:[\w"`]+\.)?([\w"`]+)/gi;
const SQL_FUNC_RE = /(?:^|\n)\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:[\w"`]+\.)?([\w"`]+)/gi;
const SQL_INDEX_RE = /(?:^|\n)\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w"`]+\.)?([\w"`]+)/gi;
const SQL_TRIGGER_RE = /(?:^|\n)\s*CREATE\s+TRIGGER\s+(?:[\w"`]+\.)?([\w"`]+)/gi;

const sqlRepograph = {
  extractImports(content: string, filePath: string) {
    const results: any[] = [];
    const seen = new Set<string>();

    SQL_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SQL_IMPORT_RE.exec(content)) !== null) {
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

    const SQL_TABLE_RE_LOCAL = /(?:^|\n)\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w"`]+\.)?([\w"`]+)/gi;

    const patterns = [
      { re: SQL_TABLE_RE_LOCAL, type: 'class' as const },
      { re: SQL_VIEW_RE, type: 'class' as const },
      { re: SQL_FUNC_RE, type: 'function' as const },
      { re: SQL_INDEX_RE, type: 'variable' as const },
      { re: SQL_TRIGGER_RE, type: 'variable' as const },
    ];

    for (const pat of patterns) {
      pat.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.re.exec(content)) !== null) {
        const rawName = m[1];
        const name = cleanSqlName(rawName);
        if (!name || seen.has(name)) continue;
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
    let currentObject: string | null = null;

    const declRe = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TRIGGER|INDEX)\s+(?:[\w"`]+\.)?([\w"`]+)/i;
    const refRe = /(?:REFERENCES|FROM|JOIN|INTO)\s+(?:[\w"`]+\.)?([\w"`]+)/gi;

    for (const line of lines) {
      const declMatch = declRe.exec(line);
      if (declMatch) {
        currentObject = cleanSqlName(declMatch[1]);
      }

      if (currentObject) {
        refRe.lastIndex = 0;
        let refMatch: RegExpExecArray | null;
        while ((refMatch = refRe.exec(line)) !== null) {
          const target = cleanSqlName(refMatch[1]);
          if (
            target &&
            target.toLowerCase() !== 'select' &&
            target.toLowerCase() !== 'values' &&
            target.toLowerCase() !== currentObject.toLowerCase()
          ) {
            const fromId = `sym:${currentObject}@${filePath}`;
            addEdge(fromId, target, 'extends');
          }
        }
      }
    }

    return edges;
  },
};

export const pack: LanguagePack = {
  metadata: {
    name: 'sql',
    version: '1.0.0',
    fileExtensions: ['.sql'],
  },
  supportedLanguages: ['sql', '.sql'],
  fileExtensions: ['.sql'],
  parserName: 'sql-parser',
  repograph: sqlRepograph,
  regexPatterns: {
    commentDetection: /--[^\n]*|\/\*[\s\S]*?\*\//g,
  },
  rules: {
    comment: { action: 'strip' },
  },
};

export default pack;
