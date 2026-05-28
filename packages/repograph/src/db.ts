import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@hermes/shared/utils/logging';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const log = createLogger('repograph:db');

/**
 * SQLite database manager for the RepoGraph intent store.
 *
 * Uses better-sqlite3 for synchronous, fast operations.
 * Falls back to a file-based JSON store if better-sqlite3 is unavailable.
 */

export interface StorageRow {
  id: number;
  intent_type: string;
  query_text: string;
  annotation: string;
  file_path: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: string | null;
}

export interface DbInterface {
  initialize(): void;
  insertIntent(row: Omit<StorageRow, 'id' | 'created_at' | 'updated_at'>): number;
  getIntent(id: number): StorageRow | undefined;
  searchIntents(query: string, limit?: number): StorageRow[];
  getIntentsByFile(filePath: string): StorageRow[];
  deleteIntent(id: number): boolean;
  getAllIntents(): StorageRow[];
  close(): void;
}

// ── JSON file store (fallback) ──────────────────────────────────────────────

class JsonFileStore implements DbInterface {
  private dbPath: string;
  private data: StorageRow[] = [];
  private nextId = 1;
  private dirty = false;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  initialize(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        this.data = JSON.parse(raw);
        this.nextId = this.data.length > 0
          ? Math.max(...this.data.map((r) => r.id)) + 1
          : 1;
        log.info(`Loaded ${this.data.length} intents from ${this.dbPath}`);
      } catch (err) {
        log.warn(`Could not load existing DB, starting fresh: ${err}`);
        this.data = [];
      }
    }

    // Auto-save every 5 seconds when dirty
    this.saveTimer = setInterval(() => this.flush(), 5000);
  }

  private flush(): void {
    if (!this.dirty) return;
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
      this.dirty = false;
    } catch (err) {
      log.error(`Failed to save intents DB: ${err}`);
    }
  }

  private save(): void {
    this.dirty = true;
  }

  insertIntent(row: Omit<StorageRow, 'id' | 'created_at' | 'updated_at'>): number {
    const now = new Date().toISOString();
    const entry: StorageRow = {
      id: this.nextId++,
      ...row,
      created_at: now,
      updated_at: now,
    };
    this.data.push(entry);
    this.save();
    return entry.id;
  }

  getIntent(id: number): StorageRow | undefined {
    return this.data.find((r) => r.id === id);
  }

  searchIntents(query: string, limit = 20): StorageRow[] {
    const lower = query.toLowerCase();
    return this.data
      .filter(
        (r) =>
          r.query_text.toLowerCase().includes(lower) ||
          r.annotation.toLowerCase().includes(lower) ||
          (r.file_path && r.file_path.toLowerCase().includes(lower)),
      )
      .slice(0, limit);
  }

  getIntentsByFile(filePath: string): StorageRow[] {
    return this.data.filter((r) => r.file_path === filePath);
  }

  deleteIntent(id: number): boolean {
    const idx = this.data.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.data.splice(idx, 1);
    this.save();
    return true;
  }

  getAllIntents(): StorageRow[] {
    return [...this.data];
  }

  close(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    this.flush();
  }
}

// ── better-sqlite3 store ────────────────────────────────────────────────────

let hasBetterSqlite3 = false;
try {
  await import('better-sqlite3');
  hasBetterSqlite3 = true;
} catch {
  hasBetterSqlite3 = false;
}

class BetterSqliteStore implements DbInterface {
  private db: any = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  initialize(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Dynamic import since it might not be available
    const betterSqlite3 = require('better-sqlite3');
    this.db = new betterSqlite3(this.dbPath);

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS intents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        intent_type TEXT NOT NULL,
        query_text TEXT NOT NULL,
        annotation TEXT NOT NULL,
        file_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_intents_file_path ON intents(file_path);
      CREATE INDEX IF NOT EXISTS idx_intents_type ON intents(intent_type);
    `);

    log.info(`SQLite intent store initialized at ${this.dbPath}`);
  }

  insertIntent(row: Omit<StorageRow, 'id' | 'created_at' | 'updated_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO intents (intent_type, query_text, annotation, file_path, metadata_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      row.intent_type,
      row.query_text,
      row.annotation,
      row.file_path ?? null,
      row.metadata_json ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  getIntent(id: number): StorageRow | undefined {
    return this.db.prepare('SELECT * FROM intents WHERE id = ?').get(id);
  }

  searchIntents(query: string, limit = 20): StorageRow[] {
    const like = `%${query}%`;
    return this.db
      .prepare(
        'SELECT * FROM intents WHERE query_text LIKE ? OR annotation LIKE ? OR file_path LIKE ? LIMIT ?',
      )
      .all(like, like, like, limit);
  }

  getIntentsByFile(filePath: string): StorageRow[] {
    return this.db
      .prepare('SELECT * FROM intents WHERE file_path = ?')
      .all(filePath);
  }

  deleteIntent(id: number): boolean {
    const result = this.db.prepare('DELETE FROM intents WHERE id = ?').run(id);
    return result.changes > 0;
  }

  getAllIntents(): StorageRow[] {
    return this.db.prepare('SELECT * FROM intents ORDER BY created_at DESC').all();
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createDb(dbPath: string): DbInterface {
  if (hasBetterSqlite3) {
    log.info('Using better-sqlite3 backend');
    try {
      return new BetterSqliteStore(dbPath);
    } catch (err) {
      log.warn(`better-sqlite3 init failed, falling back to JSON store: ${err}`);
    }
  }

  log.info('Using JSON file backend for intent store');
  return new JsonFileStore(dbPath);
}
