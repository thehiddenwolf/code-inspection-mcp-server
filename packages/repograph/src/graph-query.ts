import { CodebaseMemoryAdapter, type CmQueryResult, type CmRelationship, type CmGraphStats } from './codebase-memory-adapter.js';
import { IntentStore, type IntentRecord } from './intent-store.js';
import { createLogger } from '@hermes/shared/utils/logging';

const log = createLogger('repograph:graph-query');

/**
 * Graph query orchestrator — combines codebase-memory graph data
 * with intent store annotations for a unified query interface.
 */

export interface EnrichedQueryResult {
  symbol: string;
  file: string;
  line: number;
  kind: string;
  score: number;
  context?: string;
  /** Corresponding intent annotations, if any */
  intents: IntentRecord[];
}

export interface EnrichedRelationship {
  from: { symbol: string; file: string };
  to: { symbol: string; file: string };
  relationship: string;
  /** Intent annotations on either end of the relationship */
  intents: IntentRecord[];
}

export interface QueryResponse {
  results: EnrichedQueryResult[];
  stats: {
    total: number;
    with_intents: number;
    from_cache: boolean;
  };
}

export class GraphQuery {
  private cm: CodebaseMemoryAdapter;
  private intentStore: IntentStore;
  private queryCache = new Map<string, { results: EnrichedQueryResult[]; timestamp: number }>();
  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  constructor(cm: CodebaseMemoryAdapter, intentStore: IntentStore) {
    this.cm = cm;
    this.intentStore = intentStore;
  }

  /**
   * Query the graph for symbols matching the given term.
   * Results are enriched with intent annotations.
   */
  async querySymbols(query: string, limit = 20): Promise<QueryResponse> {
    const cacheKey = `${query}:${limit}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      log.debug(`Cache hit for "${query}"`);
      return {
        results: cached.results,
        stats: {
          total: cached.results.length,
          with_intents: cached.results.filter((r) => r.intents.length > 0).length,
          from_cache: true,
        },
      };
    }

    // Query codebase-memory
    const cmResults = await this.cm.querySymbol(query, limit);

    // Enrich with intents
    const enriched = this.enrichResults(cmResults);

    // Cache
    this.queryCache.set(cacheKey, { results: enriched, timestamp: Date.now() });

    return {
      results: enriched,
      stats: {
        total: enriched.length,
        with_intents: enriched.filter((r) => r.intents.length > 0).length,
        from_cache: false,
      },
    };
  }

  /**
   * Get relationships for a symbol, enriched with intent data.
   */
  async getRelationships(
    symbol: string,
    file?: string,
  ): Promise<EnrichedRelationship[]> {
    const relationships = await this.cm.getRelationships(symbol, file);

    return relationships.map((rel) => {
      const fromIntents = this.intentStore.getByFile(rel.from.file);
      const toIntents = this.intentStore.getByFile(rel.to.file);
      return {
        ...rel,
        intents: [...fromIntents, ...toIntents],
      };
    });
  }

  /**
   * Register a new intent annotation on the graph.
   */
  registerIntent(record: Omit<IntentRecord, 'id' | 'createdAt' | 'updatedAt'>): IntentRecord {
    return this.intentStore.register(record);
  }

  /**
   * Search intent annotations.
   */
  searchIntents(query: string, limit = 20): IntentRecord[] {
    return this.intentStore.search(query, limit);
  }

  /**
   * Trigger a rescan of the codebase.
   */
  async rescan(): Promise<CmGraphStats> {
    this.queryCache.clear();
    log.info('Cache cleared due to rescan');
    return this.cm.rescanProject();
  }

  /**
   * Get graph statistics.
   */
  async getStats(): Promise<CmGraphStats> {
    return this.cm.getStats();
  }

  /**
   * Enrich codebase-memory results with intent annotations.
   */
  private enrichResults(results: CmQueryResult[]): EnrichedQueryResult[] {
    return results.map((result) => {
      const intents = result.file
        ? this.intentStore.getByFile(result.file)
        : [];
      return {
        ...result,
        intents,
      };
    });
  }

  /**
   * Clear the query cache.
   */
  clearCache(): void {
    this.queryCache.clear();
    log.info('Query cache cleared');
  }
}
