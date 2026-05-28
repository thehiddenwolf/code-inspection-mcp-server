/**
 * @hermes/repograph — Regex-based file indexer for v1.
 *
 * Parses source files to extract symbols, imports, exports, and declarations.
 * Builds graph nodes and edges from the extracted information.
 * Supports modular language parsers registered dynamically.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import type { Symbol } from './types.js';
import type { GraphNode, GraphEdge, GraphNodeType, GraphEdgeType } from './types.js';
import { GraphEngine } from './graph-engine.js';
import { getParserForFile, getSupportedExtensions } from './languages/parser.js';

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

    // File node
    const fileNodeId = `file:${filePath}`;
    nodes.push({
      id: fileNodeId,
      type: 'file',
      label: filePath.split('/').pop() ?? filePath,
      filePath,
    });

    const parser = getParserForFile(filePath);
    if (!parser) {
      return { filePath, symbols, nodes, edges };
    }

    // ── Extract imports & build edges ──
    const imports = parser.extractImports(content, filePath);
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
    const declarations = parser.extractDeclarations(content, filePath);
    for (const decl of declarations) {
      const symId = `sym:${decl.name}@${filePath}`;
      symbols.push(decl);
      nodes.push({
        id: symId,
        type: decl.type,
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
    const relationships = parser.extractRelationships(content, filePath);
    for (const rel of relationships) {
      edges.push(rel);
    }

    return { filePath, symbols, nodes, edges };
  }

  // ── Directory ─────────────────────────────────────────────────────────────

  /**
   * Index an entire project directory recursively.
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

  // ── Internal: File Collection ─────────────────────────────────────────────

  private collectFiles(dirPath: string): string[] {
    const results: string[] = [];
    const extensions = getSupportedExtensions();

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
          } else if (stat.isFile() && extensions.has(extname(entry).toLowerCase())) {
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
