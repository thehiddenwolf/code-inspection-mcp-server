/**
 * @hermes/repograph — Graph Store (Persistence Layer)
 *
 * Provides SQLite-backed persistence for the knowledge graph, with a JSON
 * fallback for environments where native modules can't compile.
 *
 * Design doc: docs/persistence-design.md
 */

import type { GraphNode, GraphEdge } from './types.js';
import { createLogger } from '@hermes/shared/utils/logging';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const log = createLogger('repograph:graph-store');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoreDelta {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphMeta {
  schemaVersion: number;
  lastIndexedAt?: string;
  indexedFileCount: number;
  rootDirectory?: string;
  totalNodes: number;
  totalEdges: number;
}

/**
 * Persistent graph store interface.
 * The in-memory GraphEngine handles queries; this handles durable storage.
 */
export interface GraphStore {
  /** Initialize the database (create tables, run migrations). */
  initialize(): void;

  // ── Node CRUD ──

  /** Insert a node. Returns true if new, false if already exists. */
  insertNode(node: GraphNode): boolean;

  /** Get a node by ID. */
  getNode(id: string): GraphNode | undefined;

  /** Get all nodes for a file path. */
  getNodesByFile(filePath: string): GraphNode[];

  /** Get all nodes in the graph. */
  getAllNodes(): GraphNode[];

  /** Update a node's metadata. */
  updateNode(id: string, metadata: Record<string, unknown>): void;

  /** Delete a node and its edges. */
  deleteNode(id: string): void;

  // ── Edge CRUD ──

  /** Insert an edge. Returns the edge ID. */
  insertEdge(edge: GraphEdge): number;

  /** Get all edges. */
  getAllEdges(): GraphEdge[];

  /** Get outgoing edges from a node. */
  getOutgoingEdges(nodeId: string): GraphEdge[];

  /** Get incoming edges to a node. */
  getIncomingEdges(nodeId: string): GraphEdge[];

  /** Delete all edges for a set of node IDs. */
  deleteEdgesForNodes(nodeIds: Set<string>): void;

  // ── Batch / Sync ──

  /** Bulk insert nodes and edges (transactional). */
  applyDelta(delta: StoreDelta): void;

  /** Remove all nodes/edges for a given file (re-index preparation). */
  removeFile(filePath: string): void;

  /** Search nodes by label/ID (via FTS5). */
  searchNodes(query: string, limit?: number): GraphNode[];

  /** Get graph metadata. */
  getMeta(key: string): string | undefined;

  /** Set graph metadata. */
  setMeta(key: string, value: string): void;

  // ── File tracking ──

  /** Record a file as indexed. */
  recordIndexedFile(filePath: string, hash: string, nodeCount: number): void;

  /** Get the stored hash for a file. Returns null if not indexed. */
  getFileHash(filePath: string): string | null;

  /** Check if a file needs re-indexing. */
  needsReindex(filePath: string, currentHash: string): boolean;

  // ── Lifecycle ──

  /** Close the database connection. */
  close(): void;

  /** Drop all data and re-create tables (for full re-index). */
  clear(): void;
}

// ─── SQLite Graph Store ───────────────────────────────────────────────────────

const NODE_TYPES = ['file', 'class', 'function', 'interface', 'type', 'variable', 'export'] as const;
const EDGE_TYPES = ['defines', 'imports', 'calls', 'extends', 'implements'] as const;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS graph_meta (
    key   TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id        TEXT NOT NULL PRIMARY KEY,
    type      TEXT NOT NULL CHECK (type IN ('file','class','function','interface','type','variable','export')),
    label     TEXT NOT NULL,
    file_path TEXT NOT NULL,
    metadata  TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);
  CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);

  CREATE TABLE IF NOT EXISTS edges (
    id        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    from_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    to_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    type      TEXT NOT NULL CHECK (type IN ('defines','imports','calls','extends','implements')),
    metadata  TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(from_id, to_id, type)
  );

  CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
  CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
  CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);

  CREATE TABLE IF NOT EXISTS indexed_files (
    file_path  TEXT NOT NULL PRIMARY KEY,
    file_hash  TEXT NOT NULL,
    indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
    node_count INTEGER NOT NULL DEFAULT 0
  );
`;

const FTS_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id UNINDEXED,
    label,
    content='nodes',
    content_rowid='rowid'
  );
`;

function fromDbNode(row: { id: string; type: string; label: string; file_path: string; metadata: string | null }): GraphNode {
  return {
    id: row.id,
    type: row.type as GraphNode['type'],
    label: row.label,
    filePath: row.file_path,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

function toDbNode(node: GraphNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    file_path: node.filePath,
    metadata: Object.keys(node.metadata ?? {}).length > 0 ? JSON.stringify(node.metadata) : null,
    updated_at: new Date().toISOString(),
  };
}

function fromDbEdge(row: { id: number; from_id: string; to_id: string; type: string; metadata: string | null }): GraphEdge {
  return {
    from: row.from_id,
    to: row.to_id,
    type: row.type as GraphEdge['type'],
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

/**
 * SQLite-backed graph store.
 * Uses better-sqlite3 for synchronous, performant access.
 */
export class SqliteGraphStore implements GraphStore {
  private db: import('better-sqlite3').Database | null = null;
  private readonly dbPath: string;
  private initialized = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  initialize(): void {
    // Dynamically import better-sqlite3
    const Database = loadBetterSqlite3();
    if (!Database) {
      throw new Error(
        'better-sqlite3 is not available. Install it or use JsonGraphStore instead.',
      );
    }

    // Ensure parent directory exists
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(SCHEMA_SQL);

    // Try to create FTS5 table (may fail on some builds without FTS5)
    try {
      this.db.exec(FTS_SQL);
    } catch {
      log.warn('FTS5 not available — full-text search disabled. Install SQLite with FTS5 support.');
    }

    this.initialized = true;

    // Run migrations
    this.migrate();

    log.info('SQLite graph store initialized', { path: this.dbPath });
  }

  private checkInit(): import('better-sqlite3').Database {
    if (!this.db || !this.initialized) {
      throw new Error('GraphStore not initialized. Call initialize() first.');
    }
    return this.db;
  }

  private migrate(): void {
    const db = this.checkInit();
    const version = parseInt(db.prepare("SELECT value FROM graph_meta WHERE key = 'schema_version'").get() as string ?? '0', 10) || 0;

    if (version < 1) {
      // Schema v1: initial tables created above
      db.prepare("INSERT OR REPLACE INTO graph_meta (key, value) VALUES ('schema_version', '1')").run();
      log.info('Schema migrated to v1');
    }
  }

  // ── Node CRUD ──

  insertNode(node: GraphNode): boolean {
    const db = this.checkInit();
    const existing = db.prepare('SELECT id FROM nodes WHERE id = ?').get(node.id);
    if (existing) return false;

    const row = toDbNode(node);
    db.prepare(
      'INSERT INTO nodes (id, type, label, file_path, metadata, updated_at) VALUES (@id, @type, @label, @file_path, @metadata, @updated_at)',
    ).run(row);

    // Sync FTS5
    try {
      db.prepare("INSERT INTO nodes_fts (id, label) VALUES (?, ?)").run(node.id, node.label);
    } catch { /* FTS5 may not exist */ }

    return true;
  }

  getNode(id: string): GraphNode | undefined {
    const db = this.checkInit();
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return fromDbNode(row as any);
  }

  getNodesByFile(filePath: string): GraphNode[] {
    const db = this.checkInit();
    const rows = db.prepare('SELECT * FROM nodes WHERE file_path = ?').all(filePath) as Record<string, unknown>[];
    return rows.map((r) => fromDbNode(r as any));
  }

  getAllNodes(): GraphNode[] {
    const db = this.checkInit();
    const rows = db.prepare('SELECT * FROM nodes').all() as Record<string, unknown>[];
    return rows.map((r) => fromDbNode(r as any));
  }

  updateNode(id: string, metadata: Record<string, unknown>): void {
    const db = this.checkInit();
    db.prepare(
      'UPDATE nodes SET metadata = ?, updated_at = datetime(\'now\') WHERE id = ?',
    ).run(JSON.stringify(metadata), id);
  }

  deleteNode(id: string): void {
    const db = this.checkInit();
    // CASCADE will handle edges
    db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    try {
      db.prepare('DELETE FROM nodes_fts WHERE id = ?').run(id);
    } catch { /* FTS5 may not exist */ }
  }

  // ── Edge CRUD ──

  insertEdge(edge: GraphEdge): number {
    const db = this.checkInit();
    const result = db.prepare(
      'INSERT OR IGNORE INTO edges (from_id, to_id, type, metadata) VALUES (@from_id, @to_id, @type, @metadata)',
    ).run({
      from_id: edge.from,
      to_id: edge.to,
      type: edge.type,
      metadata: edge.metadata ? JSON.stringify(edge.metadata) : null,
    });
    return result.lastInsertRowid as number;
  }

  getAllEdges(): GraphEdge[] {
    const db = this.checkInit();
    const rows = db.prepare('SELECT * FROM edges').all() as Record<string, unknown>[];
    return rows.map((r) => fromDbEdge(r as any));
  }

  getOutgoingEdges(nodeId: string): GraphEdge[] {
    const db = this.checkInit();
    const rows = db.prepare('SELECT * FROM edges WHERE from_id = ?').all(nodeId) as Record<string, unknown>[];
    return rows.map((r) => fromDbEdge(r as any));
  }

  getIncomingEdges(nodeId: string): GraphEdge[] {
    const db = this.checkInit();
    const rows = db.prepare('SELECT * FROM edges WHERE to_id = ?').all(nodeId) as Record<string, unknown>[];
    return rows.map((r) => fromDbEdge(r as any));
  }

  deleteEdgesForNodes(nodeIds: Set<string>): void {
    if (nodeIds.size === 0) return;
    const db = this.checkInit();
    const placeholders = Array.from(nodeIds).map(() => '?').join(',');
    db.prepare(`DELETE FROM edges WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`).run(
      ...Array.from(nodeIds),
      ...Array.from(nodeIds),
    );
  }

  // ── Batch / Sync ──

  applyDelta(delta: StoreDelta): void {
    const db = this.checkInit();
    const insertNode = db.prepare(
      'INSERT OR REPLACE INTO nodes (id, type, label, file_path, metadata, updated_at) VALUES (@id, @type, @label, @file_path, @metadata, @updated_at)',
    );
    const insertEdge = db.prepare(
      'INSERT OR IGNORE INTO edges (from_id, to_id, type, metadata) VALUES (@from_id, @to_id, @type, @metadata)',
    );

    const transaction = db.transaction(() => {
      for (const node of delta.nodes) {
        const row = toDbNode(node);
        insertNode.run(row);
        try {
          db.prepare("INSERT OR REPLACE INTO nodes_fts (id, label) VALUES (?, ?)").run(node.id, node.label);
        } catch { /* FTS5 may not exist */ }
      }
      for (const edge of delta.edges) {
        insertEdge.run({
          from_id: edge.from,
          to_id: edge.to,
          type: edge.type,
          metadata: edge.metadata ? JSON.stringify(edge.metadata) : null,
        });
      }
    });

    transaction();
  }

  removeFile(filePath: string): void {
    const db = this.checkInit();
    const transaction = db.transaction(() => {
      // Find nodes for this file
      const nodes = db.prepare('SELECT id FROM nodes WHERE file_path = ?').all(filePath) as { id: string }[];
      const nodeIds = nodes.map((n) => n.id);

      if (nodeIds.length > 0) {
        const placeholders = nodeIds.map(() => '?').join(',');
        // Delete edges referencing these nodes
        db.prepare(`DELETE FROM edges WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`).run(...nodeIds, ...nodeIds);
        // Delete from FTS
        for (const id of nodeIds) {
          try { db.prepare('DELETE FROM nodes_fts WHERE id = ?').run(id); } catch { /* FTS5 may not exist */ }
        }
        // Delete nodes
        db.prepare(`DELETE FROM nodes WHERE id IN (${placeholders})`).run(...nodeIds);
      }

      // Remove from indexed_files
      db.prepare('DELETE FROM indexed_files WHERE file_path = ?').run(filePath);
    });

    transaction();
  }

  searchNodes(query: string, limit = 20): GraphNode[] {
    const db = this.checkInit();
    try {
      const rows = db.prepare(
        "SELECT n.* FROM nodes_fts f JOIN nodes n ON n.id = f.id WHERE nodes_fts MATCH ? ORDER BY rank LIMIT ?",
      ).all(query, limit) as Record<string, unknown>[];
      return rows.map((r) => fromDbNode(r as any));
    } catch {
      // FTS5 fallback: linear scan
      const lower = query.toLowerCase();
      const allNodes = this.getAllNodes();
      return allNodes
        .filter((n) => n.id.toLowerCase().includes(lower) || n.label.toLowerCase().includes(lower))
        .slice(0, limit);
    }
  }

  getMeta(key: string): string | undefined {
    const db = this.checkInit();
    const row = db.prepare("SELECT value FROM graph_meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    const db = this.checkInit();
    db.prepare("INSERT OR REPLACE INTO graph_meta (key, value) VALUES (?, ?)").run(key, value);
  }

  // ── File tracking ──

  recordIndexedFile(filePath: string, hash: string, nodeCount: number): void {
    const db = this.checkInit();
    db.prepare(
      'INSERT OR REPLACE INTO indexed_files (file_path, file_hash, node_count, indexed_at) VALUES (?, ?, ?, datetime(\'now\'))',
    ).run(filePath, hash, nodeCount);
  }

  getFileHash(filePath: string): string | null {
    const db = this.checkInit();
    const row = db.prepare('SELECT file_hash FROM indexed_files WHERE file_path = ?').get(filePath) as { file_hash: string } | undefined;
    return row?.file_hash ?? null;
  }

  needsReindex(filePath: string, currentHash: string): boolean {
    const storedHash = this.getFileHash(filePath);
    if (storedHash === null) return true; // Not indexed yet
    return storedHash !== currentHash;
  }

  // ── Lifecycle ──

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      log.info('Graph store closed');
    }
  }

  clear(): void {
    const db = this.checkInit();
    db.exec('DELETE FROM edges');
    db.exec('DELETE FROM nodes');
    db.exec('DELETE FROM indexed_files');
    try {
      db.exec('DELETE FROM nodes_fts');
    } catch { /* FTS5 may not exist */ }
    log.info('Graph store cleared');
  }
}

// ─── JSON Fallback Store ───────────────────────────────────────────────────────

interface JsonStoreData {
  meta: Record<string, string>;
  nodes: GraphNode[];
  edges: GraphEdge[];
  indexedFiles: Record<string, { hash: string; nodeCount: number; indexedAt: string }>;
}

/**
 * JSON file fallback for environments where better-sqlite3 can't compile.
 * Full-rewrite on every write — suitable for small graphs only.
 */
export class JsonGraphStore implements GraphStore {
  private readonly filePath: string;
  private data: JsonStoreData = {
    meta: { schema_version: '1' },
    nodes: [],
    edges: [],
    indexedFiles: {},
  };
  private initialized = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  initialize(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw);
        log.info('JSON graph store loaded from disk', { path: this.filePath });
      } catch (err) {
        log.warn('Failed to load JSON graph store, starting fresh', { err });
      }
    } else {
      log.info('JSON graph store created', { path: this.filePath });
    }

    this.initialized = true;
  }

  private checkInit(): void {
    if (!this.initialized) {
      throw new Error('GraphStore not initialized. Call initialize() first.');
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  // ── Node CRUD ──

  insertNode(node: GraphNode): boolean {
    this.checkInit();
    const exists = this.data.nodes.some((n) => n.id === node.id);
    if (exists) return false;
    this.data.nodes.push(node);
    this.save();
    return true;
  }

  getNode(id: string): GraphNode | undefined {
    this.checkInit();
    return this.data.nodes.find((n) => n.id === id);
  }

  getNodesByFile(filePath: string): GraphNode[] {
    this.checkInit();
    return this.data.nodes.filter((n) => n.filePath === filePath);
  }

  getAllNodes(): GraphNode[] {
    this.checkInit();
    return [...this.data.nodes];
  }

  updateNode(id: string, metadata: Record<string, unknown>): void {
    this.checkInit();
    const node = this.data.nodes.find((n) => n.id === id);
    if (node) {
      node.metadata = { ...node.metadata, ...metadata };
      this.save();
    }
  }

  deleteNode(id: string): void {
    this.checkInit();
    this.data.nodes = this.data.nodes.filter((n) => n.id !== id);
    this.data.edges = this.data.edges.filter((e) => e.from !== id && e.to !== id);
    this.save();
  }

  // ── Edge CRUD ──

  insertEdge(edge: GraphEdge): number {
    this.checkInit();
    const exists = this.data.edges.some((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type);
    if (exists) return -1;
    this.data.edges.push(edge);
    this.save();
    return this.data.edges.length;
  }

  getAllEdges(): GraphEdge[] {
    this.checkInit();
    return [...this.data.edges];
  }

  getOutgoingEdges(nodeId: string): GraphEdge[] {
    this.checkInit();
    return this.data.edges.filter((e) => e.from === nodeId);
  }

  getIncomingEdges(nodeId: string): GraphEdge[] {
    this.checkInit();
    return this.data.edges.filter((e) => e.to === nodeId);
  }

  deleteEdgesForNodes(nodeIds: Set<string>): void {
    this.checkInit();
    this.data.edges = this.data.edges.filter(
      (e) => !nodeIds.has(e.from) && !nodeIds.has(e.to),
    );
    this.save();
  }

  // ── Batch / Sync ──

  applyDelta(delta: StoreDelta): void {
    this.checkInit();
    for (const node of delta.nodes) {
      const idx = this.data.nodes.findIndex((n) => n.id === node.id);
      if (idx >= 0) {
        this.data.nodes[idx] = node;
      } else {
        this.data.nodes.push(node);
      }
    }
    for (const edge of delta.edges) {
      const exists = this.data.edges.some(
        (e) => e.from === edge.from && e.to === edge.to && e.type === edge.type,
      );
      if (!exists) {
        this.data.edges.push(edge);
      }
    }
    this.save();
  }

  removeFile(filePath: string): void {
    this.checkInit();
    const fileNodeIds = new Set(
      this.data.nodes.filter((n) => n.filePath === filePath).map((n) => n.id),
    );
    this.data.nodes = this.data.nodes.filter((n) => !fileNodeIds.has(n.id));
    this.data.edges = this.data.edges.filter(
      (e) => !fileNodeIds.has(e.from) && !fileNodeIds.has(e.to),
    );
    delete this.data.indexedFiles[filePath];
    this.save();
  }

  searchNodes(query: string, limit = 20): GraphNode[] {
    this.checkInit();
    const lower = query.toLowerCase();
    return this.data.nodes
      .filter((n) => n.id.toLowerCase().includes(lower) || n.label.toLowerCase().includes(lower))
      .slice(0, limit);
  }

  getMeta(key: string): string | undefined {
    this.checkInit();
    return this.data.meta[key];
  }

  setMeta(key: string, value: string): void {
    this.checkInit();
    this.data.meta[key] = value;
    this.save();
  }

  // ── File tracking ──

  recordIndexedFile(filePath: string, hash: string, nodeCount: number): void {
    this.checkInit();
    this.data.indexedFiles[filePath] = {
      hash,
      nodeCount,
      indexedAt: new Date().toISOString(),
    };
    this.save();
  }

  getFileHash(filePath: string): string | null {
    this.checkInit();
    return this.data.indexedFiles[filePath]?.hash ?? null;
  }

  needsReindex(filePath: string, currentHash: string): boolean {
    const stored = this.data.indexedFiles[filePath];
    if (!stored) return true;
    return stored.hash !== currentHash;
  }

  // ── Lifecycle ──

  close(): void {
    this.save();
    this.initialized = false;
    log.info('JSON graph store closed');
  }

  clear(): void {
    this.data = {
      meta: { schema_version: '1' },
      nodes: [],
      edges: [],
      indexedFiles: {},
    };
    this.save();
    log.info('JSON graph store cleared');
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a GraphStore, preferring SQLite if better-sqlite3 is available,
 * falling back to JSON if not.
 */
export function createGraphStore(dbPath: string): GraphStore {
  const Database = loadBetterSqlite3();
  if (Database) {
    const store = new SqliteGraphStore(dbPath);
    store.initialize();
    return store;
  }

  log.warn('better-sqlite3 not available, falling back to JSON store');
  const jsonPath = dbPath.replace(/\.db$/, '.fallback.json');
  const store = new JsonGraphStore(jsonPath);
  store.initialize();
  return store;
}

/**
 * Load a persisted graph from the store into an in-memory GraphEngine.
 */
export function loadEngineFromStore<TEngine extends { addNode(node: GraphNode): void; addEdge(edge: GraphEdge): void }>(
  engine: TEngine,
  store: GraphStore,
): void {
  const nodes = store.getAllNodes();
  const edges = store.getAllEdges();

  for (const node of nodes) {
    engine.addNode(node);
  }
  for (const edge of edges) {
    try {
      engine.addEdge(edge);
    } catch {
      // Skip edges whose endpoints don't exist (stale data)
    }
  }

  log.info(`Loaded graph from store: ${nodes.length} nodes, ${edges.length} edges`);
}

/**
 * Compute SHA-256 hash of file content for change detection.
 */
export function computeFileHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Helper to load better-sqlite3 dynamically (may not be installed).
 */
function loadBetterSqlite3(): (new (path: string) => import('better-sqlite3').Database) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('better-sqlite3');
    return mod.default ?? mod;
  } catch {
    return null;
  }
}
