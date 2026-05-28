import type { LanguageParser } from './parser.js';
import type { Symbol, GraphEdge, GraphEdgeType } from '../types.js';

// Named imports: import { X, Y as Z } from 'module'
const IMPORT_NAMED_RE =
  /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g;

// Default import: import X from 'module'
const IMPORT_DEFAULT_RE =
  /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;

// Namespace import: import * as X from 'module'
const IMPORT_NS_RE =
  /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;

// Export function: export function name(...)
const EXPORT_FUNCTION_RE =
  /export\s+(default\s+)?(?:async\s+)?function\s+(\w+)/g;

// Export class: export class name ...
const EXPORT_CLASS_RE =
  /export\s+(default\s+)?class\s+(\w+)/g;

// Export interface: export interface name ...
const EXPORT_INTERFACE_RE =
  /export\s+(default\s+)?interface\s+(\w+)/g;

// Export const/let/var: export const name = ...
const EXPORT_VARIABLE_RE =
  /export\s+(default\s+)?(const|let|var)\s+(\w+)/g;

// Export type: export type name = ...
const EXPORT_TYPE_RE =
  /export\s+type\s+(\w+)/g;

// Export enum: export enum name ...
const EXPORT_ENUM_RE =
  /export\s+(default\s+)?enum\s+(\w+)/g;

// Function declaration (non-exported)
const FUNCTION_DECL_RE =
  /(?:^|\n)\s*(?:async\s+)?function\s+(\w+)/g;

// Class declaration (non-exported)
const CLASS_DECL_RE =
  /(?:^|\n)\s*class\s+(\w+)/g;

// Interface declaration (non-exported)
const INTERFACE_DECL_RE =
  /(?:^|\n)\s*interface\s+(\w+)/g;

// Type declaration (non-exported)
const TYPE_DECL_RE =
  /(?:^|\n)\s*type\s+(\w+)\s*=/g;

// Const/let/var declaration (non-exported)
const VARIABLE_DECL_RE =
  /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(\w+)/g;

// Extends clause: class X extends Y
const EXTENDS_RE =
  /(?:class|interface)\s+\w+\s+extends\s+(\w+)(?:<[^>]*>)?(?:,|\s*\{|\s+implements)/g;

// Implements clause: class X implements Y
const IMPLEMENTS_RE =
  /class\s+\w+\s+(?:extends\s+\w+\s+)?implements\s+(\w+)/g;

export const JavaScriptParser: LanguageParser = {
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],

  extractImports(content: string, filePath: string) {
    const results: Array<{ source: string; names: string[]; defaultName?: string }> = [];
    const seen = new Set<string>();

    IMPORT_NAMED_RE.lastIndex = 0;
    IMPORT_DEFAULT_RE.lastIndex = 0;
    IMPORT_NS_RE.lastIndex = 0;

    // Named imports
    let match: RegExpExecArray | null;
    while ((match = IMPORT_NAMED_RE.exec(content)) !== null) {
      const namesStr = match[1]!;
      const source = match[2]!;
      const names = namesStr.split(',').map((n) => {
        const parts = n.trim().split(/\s+as\s+/);
        return parts[parts.length - 1]!.trim();
      });
      const key = `${source}:${names.join(',')}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ source, names });
      }
    }

    // Default imports
    while ((match = IMPORT_DEFAULT_RE.exec(content)) !== null) {
      const defaultName = match[1]!;
      const source = match[2]!;
      const key = `${source}:default`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ source, names: [defaultName], defaultName });
      }
    }

    // Namespace imports
    while ((match = IMPORT_NS_RE.exec(content)) !== null) {
      const ns = match[1]!;
      const source = match[2]!;
      const key = `${source}:*`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ source, names: [ns] });
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

    type DeclPattern = { re: RegExp; type: Symbol['type']; exported: boolean; nameGroup: number };

    const patterns: DeclPattern[] = [
      { re: EXPORT_FUNCTION_RE, type: 'function', exported: true, nameGroup: 2 },
      { re: EXPORT_CLASS_RE, type: 'class', exported: true, nameGroup: 2 },
      { re: EXPORT_INTERFACE_RE, type: 'interface', exported: true, nameGroup: 2 },
      { re: EXPORT_VARIABLE_RE, type: 'variable', exported: true, nameGroup: 3 },
      { re: EXPORT_TYPE_RE, type: 'type', exported: true, nameGroup: 1 },
      { re: EXPORT_ENUM_RE, type: 'class', exported: true, nameGroup: 2 },
      { re: FUNCTION_DECL_RE, type: 'function', exported: false, nameGroup: 1 },
      { re: CLASS_DECL_RE, type: 'class', exported: false, nameGroup: 1 },
      { re: INTERFACE_DECL_RE, type: 'interface', exported: false, nameGroup: 1 },
      { re: TYPE_DECL_RE, type: 'type', exported: false, nameGroup: 1 },
      { re: VARIABLE_DECL_RE, type: 'variable', exported: false, nameGroup: 1 },
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
          exported: pat.exported,
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

    EXTENDS_RE.lastIndex = 0;
    IMPLEMENTS_RE.lastIndex = 0;

    // Extends relationships
    let m: RegExpExecArray | null;
    while ((m = EXTENDS_RE.exec(content)) !== null) {
      const parentName = m[1]!;
      // Find the class/interface being defined right before this extends
      const before = content.slice(0, m.index);
      const classMatch = before.match(
        /(?:class|interface)\s+(\w+)\s+extends\s*$/m,
      );
      if (classMatch) {
        addEdge(`sym:${classMatch[1]}@${filePath}`, parentName, 'extends');
      }
    }

    // Implements relationships
    while ((m = IMPLEMENTS_RE.exec(content)) !== null) {
      const ifaceName = m[1]!;
      const before = content.slice(0, m.index);
      const classMatch = before.match(/class\s+(\w+)/);
      if (classMatch) {
        addEdge(`sym:${classMatch[1]}@${filePath}`, ifaceName, 'implements');
      }
    }

    return edges;
  },
};
