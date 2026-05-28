import type { LanguageParser } from './parser.js';
import type { Symbol, GraphEdge, GraphEdgeType } from '../types.js';

// C# Regex Patterns
const CS_USING_RE = /^\s*using\s+(?:static\s+)?(?:([\w@]+)\s*=\s*)?([\w.]+);/gm;
const CS_CLASS_RE = /(?:^|\n)\s*(?:(?:public|private|protected|internal|static|sealed|abstract|partial)\s+)*class\s+(\w+)/g;
const CS_INTERFACE_RE = /(?:^|\n)\s*(?:(?:public|private|protected|internal|partial)\s+)*interface\s+(\w+)/g;
const CS_STRUCT_RE = /(?:^|\n)\s*(?:(?:public|private|protected|internal|readonly|partial|ref)\s+)*struct\s+(\w+)/g;
const CS_RECORD_RE = /(?:^|\n)\s*(?:(?:public|private|protected|internal|partial)\s+)*record\s+(?:class\s+|struct\s+)?(\w+)/g;
const CS_ENUM_RE = /(?:^|\n)\s*(?:(?:public|private|protected|internal)\s+)*enum\s+(\w+)/g;
const CS_METHOD_RE = /(?:^|\n)\s*(?:(?:public|private|protected|internal|static|async|virtual|override|abstract|sealed|partial)\s+)+(?!class|interface|struct|record|enum|namespace|new|return|if|while|for|foreach|switch|using|lock|catch)([\w.<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)/g;
const CS_INHERITANCE_RE = /(?:class|interface|struct|record)\s+(\w+)(?:<[^>]*>)?\s*:\s*([^{;]+?)(?=\s*(?:\{|;|\bwhere\b))/g;

export const CSharpParser: LanguageParser = {
  extensions: ['.cs'],

  extractImports(content: string, filePath: string) {
    const results: Array<{ source: string; names: string[]; defaultName?: string }> = [];
    const seen = new Set<string>();

    CS_USING_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CS_USING_RE.exec(content)) !== null) {
      const alias = match[1];
      const source = match[2]!;
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

    type CSDeclPattern = { re: RegExp; type: Symbol['type']; nameGroup: number };
    const patterns: CSDeclPattern[] = [
      { re: CS_CLASS_RE, type: 'class', nameGroup: 1 },
      { re: CS_INTERFACE_RE, type: 'interface', nameGroup: 1 },
      { re: CS_STRUCT_RE, type: 'class', nameGroup: 1 },
      { re: CS_RECORD_RE, type: 'class', nameGroup: 1 },
      { re: CS_ENUM_RE, type: 'class', nameGroup: 1 },
      { re: CS_METHOD_RE, type: 'function', nameGroup: 2 },
    ];

    for (const pat of patterns) {
      pat.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.re.exec(content)) !== null) {
        const name = m[pat.nameGroup]!;
        if (seen.has(name)) continue;
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

    CS_INHERITANCE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CS_INHERITANCE_RE.exec(content)) !== null) {
      const subName = m[1]!;
      const targetsStr = m[2]!;
      const targets = targetsStr.split(',').map((t) => {
        return t.trim().split('<')[0]!.trim();
      });

      const fromId = `sym:${subName}@${filePath}`;

      for (const target of targets) {
        if (!target) continue;
        const isInterface = /^[I][A-Z]/.test(target);
        const type: GraphEdgeType = isInterface ? 'implements' : 'extends';
        addEdge(fromId, target, type);
      }
    }
    return edges;
  },
};
