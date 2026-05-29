/**
 * @hermes/repograph — In-memory knowledge graph engine.
 *
 * Manages nodes (files, symbols) and directed edges (defines, imports, calls,
 * extends, implements) and provides BFS-based querying, reference lookup, and
 * definition resolution.
 */

import type {
  GraphNode,
  GraphEdge,
  GraphNodeType,
  GraphEdgeType,
  GraphQuery,
  QueryResult,
} from './types.js';

// ── Graph Engine ──────────────────────────────────────────────────────────────

export class GraphEngine {
  /** nodeId → GraphNode */
  private nodes: Map<string, GraphNode> = new Map();
  /** nodeId → outgoing edges */
  private edgesOut: Map<string, GraphEdge[]> = new Map();
  /** nodeId → incoming edges */
  private edgesIn: Map<string, GraphEdge[]> = new Map();

  // ── Node Management ──────────────────────────────────────────────────────

  addNode(node: GraphNode): void {
    if (this.nodes.has(node.id)) return;
    this.nodes.set(node.id, node);
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): GraphNode[] {
    const result: GraphNode[] = [];
    this.nodes.forEach((node) => result.push(node));
    return result;
  }

  getNodesByType(type: GraphNodeType): GraphNode[] {
    const result: GraphNode[] = [];
    this.nodes.forEach((node) => {
      if (node.type === type) result.push(node);
    });
    return result;
  }

  getNodesByFile(filePath: string): GraphNode[] {
    const result: GraphNode[] = [];
    this.nodes.forEach((node) => {
      if (node.filePath === filePath) result.push(node);
    });
    return result;
  }

  clearRepository(repository: string): void {
    // 1. Delete nodes of this repository and their edge mapping placeholders
    for (const [id, node] of this.nodes.entries()) {
      if ((node.repository ?? 'default') === repository) {
        this.nodes.delete(id);
        this.edgesOut.delete(id);
        this.edgesIn.delete(id);
      }
    }
    // 2. Filter remaining edge arrays to remove references belonging to this repository
    for (const [fromId, edges] of this.edgesOut.entries()) {
      const filtered = edges.filter((e) => (e.repository ?? 'default') !== repository);
      if (filtered.length === 0) {
        this.edgesOut.delete(fromId);
      } else {
        this.edgesOut.set(fromId, filtered);
      }
    }
    for (const [toId, edges] of this.edgesIn.entries()) {
      const filtered = edges.filter((e) => (e.repository ?? 'default') !== repository);
      if (filtered.length === 0) {
        this.edgesIn.delete(toId);
      } else {
        this.edgesIn.set(toId, filtered);
      }
    }
  }

  // ── Edge Management ──────────────────────────────────────────────────────

  addEdge(edge: GraphEdge): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error(
        `Cannot add edge: missing node(s) '${edge.from}' → '${edge.to}'`,
      );
    }
    // Avoid duplicate edges
    const existing = this.edgesOut.get(edge.from) ?? [];
    if (existing.some((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type)) {
      return;
    }
    existing.push(edge);
    this.edgesOut.set(edge.from, existing);

    const incoming = this.edgesIn.get(edge.to) ?? [];
    incoming.push(edge);
    this.edgesIn.set(edge.to, incoming);
  }

  getOutgoingEdges(nodeId: string): GraphEdge[] {
    return this.edgesOut.get(nodeId) ?? [];
  }

  getIncomingEdges(nodeId: string): GraphEdge[] {
    return this.edgesIn.get(nodeId) ?? [];
  }

  getAllEdges(): GraphEdge[] {
    const all: GraphEdge[] = [];
    this.edgesOut.forEach((edges) => {
      for (const e of edges) all.push(e);
    });
    return all;
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  /**
   * BFS-based query against the graph.
   * Finds nodes whose label or id contains the query string (case-insensitive),
   * then returns the subgraph reachable from those seed nodes up to the
   * configured breadth-first depth.
   */
  query(q: GraphQuery): QueryResult {
    const queryStr = q.query.toLowerCase();
    const maxResults = 50;

    // Find seed nodes matching the query
    const seedNodes: GraphNode[] = [];
    const allNodes = this.getAllNodes();
    for (const node of allNodes) {
      if (seedNodes.length >= maxResults) break;

      // Apply scope filter
      if (q.scope === 'file' && q.filePath && node.filePath !== q.filePath) continue;
      // Apply repository filter
      if (q.repository && node.repository !== q.repository) continue;

      if (
        node.id.toLowerCase().includes(queryStr) ||
        node.label.toLowerCase().includes(queryStr) ||
        node.id.toLowerCase().replace(/^[^:]+::/, '').includes(queryStr)
      ) {
        seedNodes.push(node);
      }
    }

    // BFS from seed nodes
    const visited = new Set<string>();
    const depths: Record<string, number> = {};
    const resultNodes: GraphNode[] = [];
    const resultEdges: GraphEdge[] = [];

    // Max BFS depth — 3 for project scope, 2 for module, 1 for file
    const maxDepth = q.scope === 'project' ? 3 : q.scope === 'module' ? 2 : 1;

    const queue: Array<{ id: string; depth: number }> = [];

    for (const seed of seedNodes) {
      if (!visited.has(seed.id)) {
        visited.add(seed.id);
        depths[seed.id] = 0;
        resultNodes.push(seed);
        queue.push({ id: seed.id, depth: 0 });
      }
    }

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      const outgoing = this.getOutgoingEdges(id);
      const incoming = this.getIncomingEdges(id);
      const allEdges = [...outgoing, ...incoming];

      for (const edge of allEdges) {
        if (!resultEdges.some((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type)) {
          resultEdges.push(edge);
        }

        const neighborId = edge.from === id ? edge.to : edge.from;
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          depths[neighborId] = depth + 1;
          const neighbor = this.nodes.get(neighborId);
          if (neighbor) {
            resultNodes.push(neighbor);
          }
          queue.push({ id: neighborId, depth: depth + 1 });
        }
      }
    }

    return { nodes: resultNodes, edges: resultEdges, depths };
  }

  // ── References ────────────────────────────────────────────────────────────

  /**
   * Find all references to a symbol across the project (or within a specific file).
   * This looks for edges of type 'imports' or 'calls' pointing *to* the symbol.
   */
  findReferences(
    symbolName: string,
    projectPath?: string,
    repository?: string,
  ): { node: GraphNode; references: GraphEdge[] }[] {
    const results: { node: GraphNode; references: GraphEdge[] }[] = [];
    const symbolNodes = this.findSymbolNodes(symbolName);

    for (const node of symbolNodes) {
      if (repository && node.repository !== repository) continue;

      const incoming = this.getIncomingEdges(node.id);
      const refs = incoming.filter(
        (e) => e.type === 'imports' || e.type === 'calls',
      );

      const filteredRefs = projectPath
        ? refs.filter((r) => {
            const fromNode = this.nodes.get(r.from);
            return fromNode?.filePath.startsWith(projectPath);
          })
        : refs;

      if (filteredRefs.length > 0 || !projectPath) {
        results.push({ node, references: filteredRefs });
      }
    }

    return results;
  }

  // ── Definitions ───────────────────────────────────────────────────────────

  /**
   * Find the definition of a symbol. If `filePath` is provided, narrow search
   * to that file. Looks for nodes that represent the definition and have
   * incoming 'defines' edges or are themselves declaration-type nodes.
   */
  findDefinitions(symbolName: string, filePath?: string, repository?: string): GraphNode[] {
    const candidates: GraphNode[] = [];
    const declTypes: GraphNodeType[] = [
      'class', 'function', 'interface', 'type', 'variable', 'export',
    ];
    const declTypeSet = new Set<string>(declTypes);

    this.nodes.forEach((node) => {
      const nameMatch =
        node.id.toLowerCase() === symbolName.toLowerCase() ||
        node.id.toLowerCase().endsWith(`.${symbolName.toLowerCase()}`) ||
        node.label.toLowerCase() === symbolName.toLowerCase() ||
        node.id.toLowerCase().replace(/^[^:]+::/, '') === symbolName.toLowerCase() ||
        node.id.toLowerCase().replace(/^[^:]+::/, '').endsWith(`.${symbolName.toLowerCase()}`);

      if (!nameMatch) return;
      if (!declTypeSet.has(node.type)) return;
      if (filePath && node.filePath !== filePath) return;
      if (repository && node.repository !== repository) return;

      candidates.push(node);
    });

    return candidates;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Normalize a symbol name for use as a node ID.
   * Convention: `file:<path>` for files, `sym:<name>` for symbols.
   */
  static nodeId(type: 'file', path: string, repository?: string): string;
  static nodeId(type: 'sym', name: string, filePath?: string, repository?: string): string;
  static nodeId(type: 'file' | 'sym', name: string, filePathOrRepo?: string, repository?: string): string {
    let activeRepo = repository;
    let filePath = filePathOrRepo;
    if (type === 'file') {
      activeRepo = filePathOrRepo;
      filePath = undefined;
    }
    const prefix = (activeRepo && activeRepo !== 'default') ? `${activeRepo}::` : '';
    if (type === 'file') return `${prefix}file:${name}`;
    return filePath ? `${prefix}sym:${name}@${filePath}` : `${prefix}sym:${name}`;
  }

  /** Count of nodes in the graph */
  get nodeCount(): number {
    return this.nodes.size;
  }

  /** Count of edges in the graph */
  get edgeCount(): number {
    let count = 0;
    this.edgesOut.forEach((edges) => { count += edges.length; });
    return count;
  }

  /** Reset the entire graph */
  clear(): void {
    this.nodes.clear();
    this.edgesOut.clear();
    this.edgesIn.clear();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private findSymbolNodes(name: string): GraphNode[] {
    const lower = name.toLowerCase();
    const results: GraphNode[] = [];
    this.nodes.forEach((node) => {
      if (
        node.id.toLowerCase().includes(lower) ||
        node.label.toLowerCase().includes(lower)
      ) {
        results.push(node);
      }
    });
    return results;
  }
}
