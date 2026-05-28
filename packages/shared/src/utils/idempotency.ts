import { createHash, randomUUID } from 'node:crypto';

/**
 * Idempotency key helpers for MCP tool calls.
 * Prevents duplicate execution of the same tool request.
 */

/** Default TTL for idempotency keys (24 hours in ms) */
export const DEFAULT_IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000;

/** Generate a unique idempotency key */
export function generateIdempotencyKey(): string {
  return randomUUID();
}

/** Derive a deterministic idempotency key from tool name + input hash */
export function deriveIdempotencyKey(toolName: string, input: Record<string, unknown>): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(input, Object.keys(input).sort()))
    .digest('hex')
    .slice(0, 16);

  return `idem-${toolName}-${hash}`;
}

/** Check if an idempotency key has expired */
export function isExpired(timestamp: number, ttl: number = DEFAULT_IDEMPOTENCY_TTL): boolean {
  return Date.now() - timestamp > ttl;
}

/** Interface for idempotency stores */
export interface IdempotencyStore {
  get(key: string): Promise<{ result: unknown; timestamp: number } | null>;
  set(key: string, result: unknown, ttl?: number): Promise<void>;
}

/** In-memory idempotency store (default, suitable for single-process deployments) */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private store = new Map<string, { result: unknown; timestamp: number }>();

  async get(key: string): Promise<{ result: unknown; timestamp: number } | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (isExpired(entry.timestamp)) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async set(key: string, result: unknown, ttl?: number): Promise<void> {
    this.store.set(key, { result, timestamp: Date.now() });

    // Schedule cleanup after TTL
    const timeout = ttl ?? DEFAULT_IDEMPOTENCY_TTL;
    setTimeout(() => {
      this.store.delete(key);
    }, timeout).unref();
  }
}
