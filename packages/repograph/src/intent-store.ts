import type { DbInterface, StorageRow } from './db.js';
import { createLogger } from '@hermes/shared/utils/logging';

const log = createLogger('repograph:intent-store');

/**
 * Intent store — companion storage for human/AI intent annotations
 * about code relationships.
 *
 * While codebase-memory handles the raw structural graph (symbols,
 * references, call graphs), the intent store captures semantic
 * metadata: why certain dependencies exist, what the architect intended,
 * deprecation notes, migration plans.
 */

export type IntentType =
  | 'dependency'
  | 'layer_override'
  | 'deprecation'
  | 'migration'
  | 'refactor'
  | 'architecture_note'
  | 'standard'
  | 'tech_debt'
  | 'security_review'
  | 'design_decision';

export interface IntentRecord {
  id: number;
  intentType: IntentType;
  queryText: string;
  annotation: string;
  filePath: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
}

function toRecord(row: StorageRow): IntentRecord {
  return {
    id: row.id,
    intentType: row.intent_type as IntentType,
    queryText: row.query_text,
    annotation: row.annotation,
    filePath: row.file_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
  };
}

function toRow(record: Omit<IntentRecord, 'id' | 'createdAt' | 'updatedAt'>): Omit<StorageRow, 'id' | 'created_at' | 'updated_at'> {
  return {
    intent_type: record.intentType,
    query_text: record.queryText,
    annotation: record.annotation,
    file_path: record.filePath,
    metadata_json: record.metadata ? JSON.stringify(record.metadata) : null,
  };
}

export class IntentStore {
  private db: DbInterface;

  constructor(db: DbInterface) {
    this.db = db;
  }

  /**
   * Register a new intent annotation.
   */
  register(record: Omit<IntentRecord, 'id' | 'createdAt' | 'updatedAt'>): IntentRecord {
    const id = this.db.insertIntent(toRow(record));
    const saved = this.db.getIntent(id);
    if (!saved) throw new Error(`Failed to retrieve inserted intent (id=${id})`);
    log.info(`Registered intent #${id}: ${record.intentType} on "${record.queryText}"`);
    return toRecord(saved);
  }

  /**
   * Get a specific intent by ID.
   */
  get(id: number): IntentRecord | undefined {
    const row = this.db.getIntent(id);
    return row ? toRecord(row) : undefined;
  }

  /**
   * Search intents by text.
   */
  search(query: string, limit = 20): IntentRecord[] {
    const rows = this.db.searchIntents(query, limit);
    return rows.map(toRecord);
  }

  /**
   * Get all intents pertaining to a specific file.
   */
  getByFile(filePath: string): IntentRecord[] {
    const rows = this.db.getIntentsByFile(filePath);
    return rows.map(toRecord);
  }

  /**
   * Delete an intent annotation.
   */
  delete(id: number): boolean {
    const result = this.db.deleteIntent(id);
    if (result) log.info(`Deleted intent #${id}`);
    return result;
  }

  /**
   * List all intents.
   */
  listAll(): IntentRecord[] {
    return this.db.getAllIntents().map(toRecord);
  }

  /**
   * Close the underlying store.
   */
  close(): void {
    this.db.close();
  }
}
