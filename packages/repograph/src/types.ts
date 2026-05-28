/**
 * @hermes/repograph — Core type definitions for the RepoGraph knowledge graph.
 *
 * These types define the in-memory graph structure: nodes (files, symbols),
 * edges (relationships), and the Symbol extraction result.
 */

// ── Node & Edge Types ─────────────────────────────────────────────────────────

export type GraphNodeType =
  | 'file'
  | 'class'
  | 'function'
  | 'interface'
  | 'type'
  | 'variable'
  | 'export';

export type GraphEdgeType =
  | 'defines'
  | 'imports'
  | 'calls'
  | 'extends'
  | 'implements';

// ── Graph Primitives ──────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  filePath: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: GraphEdgeType;
  metadata?: Record<string, unknown>;
}

// ── Indexer Types ─────────────────────────────────────────────────────────────

export interface Symbol {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'variable';
  exported: boolean;
  line: number;
  column: number;
  filePath: string;
  references?: { filePath: string; line: number }[];
}

// ── Query Types ───────────────────────────────────────────────────────────────

export type QueryScope = 'file' | 'module' | 'project';

export interface GraphQuery {
  query: string;
  filePath?: string;
  scope: QueryScope;
}

export interface QueryResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Breadth-first depth of each matched node */
  depths: Record<string, number>;
}
