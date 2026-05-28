import type { LanguageParser } from './parser.js';
import type { Symbol, GraphEdge, GraphEdgeType } from '../types.js';

// SQL Regex Patterns
const SQL_IMPORT_RE = /^\s*(?:\\i|source)\s+['"]?([\w./-]+)['"]?/gim;

const SQL_TABLE_RE = /(?:^|\n)\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w"`]+\.)?([\w"`]+)/gi;
const SQL_VIEW_RE = /(?:^|\n)\s*CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:[\w"`]+\.)?([\w"`]+)/gi;
const SQL_FUNC_RE = /(?:^|\n)\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:[\w"`]+\.)?([\w"`]+)/gi;
const SQL_INDEX_RE = /(?:^|\n)\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w"`]+\.)?([\w"`]+)/gi;
const SQL_TRIGGER_RE = /(?:^|\n)\s*CREATE\s+TRIGGER\s+(?:[\w"`]+\.)?([\w"`]+)/gi;

function cleanSqlName(name: string): string {
  return name.replace(/['"`]/g, '').trim();
}

export const SQLParser: LanguageParser = {
  extensions: ['.sql'],

  extractImports(content: string, filePath: string) {
    const results: Array<{ source: string; names: string[]; defaultName?: string }> = [];
    const seen = new Set<string>();

    SQL_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SQL_IMPORT_RE.exec(content)) !== null) {
      const source = match[1]!;
      if (!seen.has(source)) {
        seen.add(source);
        results.push({ source, names: [] });
      }
    }
    return results;
  },

  extractDeclarations(content: string, filePath: string) {
    const symbols: Symbol[] = [];
    const lines = content.split('\n');
    const seen = new Set<string>();

    // Calculate line/column from regex index
    const posFromIndex = (idx: number): { line: number; column: number } => {
      for (let i = 0; i < lines.length; i++) {
        const lineLen = lines[i]!.length + 1; // +1 for newline
        if (idx < lineLen) {
          return { line: i + 1, column: idx + 1 };
        }
        idx -= lineLen;
      }
      return { line: lines.length, column: 1 };
    };

    type SqlDeclPattern = { re: RegExp; type: Symbol['type'] };
    const patterns: SqlDeclPattern[] = [
      { re: SQL_TABLE_RE, type: 'class' },
      { re: SQL_VIEW_RE, type: 'class' },
      { re: SQL_FUNC_RE, type: 'function' },
      { re: SQL_INDEX_RE, type: 'variable' },
      { re: SQL_TRIGGER_RE, type: 'variable' },
    ];

    for (const pat of patterns) {
      pat.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.re.exec(content)) !== null) {
        const rawName = m[1]!;
        const name = cleanSqlName(rawName);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const pos = posFromIndex(m.index);
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
    const edges: GraphEdge[] = [];
    const seenEdges = new Set<string>();

    const addEdge = (fromId: string, toLabel: string, type: GraphEdgeType) => {
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
    // Uses global flag 'g' to find all references on the line/block
    const refRe = /(?:REFERENCES|FROM|JOIN|INTO)\s+(?:[\w"`]+\.)?([\w"`]+)/gi;

    for (const line of lines) {
      const declMatch = declRe.exec(line);
      if (declMatch) {
        currentObject = cleanSqlName(declMatch[1]!);
      }

      if (currentObject) {
        refRe.lastIndex = 0;
        let refMatch: RegExpExecArray | null;
        while ((refMatch = refRe.exec(line)) !== null) {
          const target = cleanSqlName(refMatch[1]!);
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
