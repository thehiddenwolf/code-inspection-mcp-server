/**
 * @hermes/repograph — Regex-based file indexer for v1.
 *
 * Parses source files (TypeScript, JavaScript) to extract symbols, imports,
 * exports, and declarations. Builds graph nodes and edges from the extracted
 * information. No Tree-sitter dependency — keeps it lightweight.
 *
 * Limitations (v1):
 * - Does NOT resolve identifier references across files (no cross-file analysis).
 * - Does NOT handle dynamic imports, re-exports, or wildcard exports.
 * - Does NOT parse JSX/TSX or non-JS languages.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Symbol } from './types.js';
import type { GraphNode, GraphEdge, GraphNodeType, GraphEdgeType } from './types.js';
import { GraphEngine } from './graph-engine.js';

export interface IndexedFile {
  filePath: string;
  symbols: Symbol[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface IndexedProject {
  rootDir: string;
  files: IndexedFile[];
  totalSymbols: number;
  totalNodes: number;
  totalEdges: number;
}

// ── Regex Patterns ────────────────────────────────────────────────────────────

// Named imports: import { X, Y as Z } from 'module'
const IMPORT_NAMED_RE =
  /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g;

// Default import: import X from 'module'
const IMPORT_DEFAULT_RE =
  /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;

// Namespace import: import * as X from 'module'
const IMPORT_NS_RE =
  /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;

// Side-effect import: import 'module'
const IMPORT_SIDE_EFFECT_RE =
  /import\s+['"]([^'"]+)['"]/g;

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

// Named export list: export { X, Y as Z }
const EXPORT_NAMED_LIST_RE =
  /export\s+\{\s*([^}]+)\s*\}/g;

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

// ── File Indexer ──────────────────────────────────────────────────────────────

export class FileIndexer {
  private graphNodeIdCounter = 0;

  // ── Initialization ──

  constructor(private store: import('./graph-store.js').GraphStore | null = null) {}

  /**
   * Compute a SHA-256 hash of file content for change detection.
   */
  static computeHash(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  // ── Single File ──────────────────────────────────────────────────────────

  /**
   * Index a single file: extract symbols and build graph nodes/edges.
   */
  indexFile(filePath: string, content: string): IndexedFile {
    const symbols: Symbol[] = [];
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const lines = content.split('\n');

    // File node
    const fileNodeId = `file:${filePath}`;
    nodes.push({
      id: fileNodeId,
      type: 'file',
      label: filePath.split('/').pop() ?? filePath,
      filePath,
    });

    // ── Extract imports & build edges ──
    const imports = this.extractImports(content, filePath);
    for (const imp of imports) {
      const importNodeId = GraphEngine.nodeId('file', imp.source);
      nodes.push({
        id: importNodeId,
        type: 'file',
        label: imp.source.split('/').pop() ?? imp.source,
        filePath: imp.source,
      });
      edges.push({
        from: fileNodeId,
        to: importNodeId,
        type: 'imports',
        metadata: { names: imp.names },
      });
      if (imp.defaultName) {
        edges.push({
          from: fileNodeId,
          to: `sym:${imp.defaultName}`,
          type: 'imports',
          metadata: { default: true },
        });
      }
    }

    // ── Extract declarations ──
    const declarations = this.extractDeclarations(content, filePath);
    for (const decl of declarations) {
      const symId = `sym:${decl.name}@${filePath}`;
      symbols.push(decl);
      nodes.push({
        id: symId,
        type: decl.type as GraphNodeType,
        label: decl.name,
        filePath,
        metadata: { exported: decl.exported, line: decl.line, column: decl.column },
      });
      edges.push({
        from: fileNodeId,
        to: symId,
        type: 'defines',
      });
    }

    // ── Extract extends/implements relationships ──
    const relationships = this.extractRelationships(content, filePath);
    for (const rel of relationships) {
      edges.push(rel);
    }

    return { filePath, symbols, nodes, edges };
  }

  // ── Directory ─────────────────────────────────────────────────────────────

  /**
   * Index an entire project directory recursively.
   * Only processes .ts, .tsx, .js, .jsx, .mjs, .cjs files.
   */
  indexDirectory(dirPath: string, rootDir?: string): IndexedProject {
    const actualRoot = rootDir ?? dirPath;
    const allFiles = this.collectFiles(dirPath);
    const indexedFiles: IndexedFile[] = [];
    let totalSymbols = 0;
    let totalNodes = 0;
    let totalEdges = 0;

    for (const filePath of allFiles) {
      const relPath = relative(actualRoot, filePath);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const indexed = this.indexFile(relPath, content);
        indexedFiles.push(indexed);
        totalSymbols += indexed.symbols.length;
        totalNodes += indexed.nodes.length;
        totalEdges += indexed.edges.length;
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    return {
      rootDir: actualRoot,
      files: indexedFiles,
      totalSymbols,
      totalNodes,
      totalEdges,
    };
  }

  // ── Index into a GraphEngine ──────────────────────────────────────────────

  /**
   * Apply an IndexedFile's nodes and edges to a GraphEngine.
   * Returns the number of new nodes added.
   */
  applyToGraph(
    graph: import('./graph-engine.js').GraphEngine,
    indexed: IndexedFile,
  ): number {
    let added = 0;
    for (const node of indexed.nodes) {
      if (!graph.hasNode(node.id)) {
        graph.addNode(node);
        added++;
      }
    }
    for (const edge of indexed.edges) {
      try {
        graph.addEdge(edge);
      } catch {
        // Edge refers to missing node — skip silently in v1
      }
    }
    return added;
  }

  /**
   * Apply an entire IndexedProject to a GraphEngine.
   */
  applyProjectToGraph(
    graph: import('./graph-engine.js').GraphEngine,
    project: IndexedProject,
  ): { nodesAdded: number; edgesAdded: number } {
    let nodesAdded = 0;
    let edgesAdded = 0;
    for (const file of project.files) {
      nodesAdded += this.applyToGraph(graph, file);
      edgesAdded += file.edges.length;
    }
    return { nodesAdded, edgesAdded };
  }

  // ── Internal: Import Extraction ───────────────────────────────────────────

  private extractImports(
    content: string,
    filePath: string,
  ): Array<{ source: string; names: string[]; defaultName?: string }> {
    const results: Array<{ source: string; names: string[]; defaultName?: string }> = [];
    const seen = new Set<string>();

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
  }

  // ── Internal: Declaration Extraction ──────────────────────────────────────

  private extractDeclarations(content: string, filePath: string): Symbol[] {
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
  }

  // ── Internal: Relationship Extraction ─────────────────────────────────────

  private extractRelationships(
    content: string,
    filePath: string,
  ): GraphEdge[] {
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
  }

  // ── Internal: File Collection ─────────────────────────────────────────────

  private collectFiles(dirPath: string): string[] {
    const results: string[] = [];
    const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

    const walk = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        // Skip node_modules, dist, .git
        if (
          entry === 'node_modules' ||
          entry === 'dist' ||
          entry === '.git' ||
          entry.startsWith('.')
        )
          continue;
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            walk(fullPath);
          } else if (stat.isFile() && extensions.has(extname(entry))) {
            results.push(fullPath);
          }
        } catch {
          // Permission denied, etc.
        }
      }
    };

    walk(dirPath);
    return results;
  }
}
