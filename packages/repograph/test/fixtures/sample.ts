/**
 * Sample TypeScript file for testing the RepoGraph file indexer.
 * Contains various import, export, and declaration patterns.
 */

import { UserService, UserProfile, UserRole, createDefaultUser } from './sample-imported.js';
import type { SomeType } from './types.d.ts';
import * as Helpers from './helpers.js';
import './polyfills.js';

// ── Exported interface ────────────────────────────────────────────────────────

export interface Repository<T> {
  get(id: string): Promise<T | null>;
  save(entity: T): Promise<void>;
  delete(id: string): Promise<boolean>;
}

// ── Exported type alias ───────────────────────────────────────────────────────

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ── Exported class ────────────────────────────────────────────────────────────

export class InMemoryRepository<T extends { id: string }> implements Repository<T> {
  private items = new Map<string, T>();

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null;
  }

  async save(entity: T): Promise<void> {
    this.items.set(entity.id, entity);
  }

  async delete(id: string): Promise<boolean> {
    return this.items.delete(id);
  }
}

// ── Exported function ─────────────────────────────────────────────────────────

export async function findUser(id: string): Promise<UserProfile | null> {
  const service = new UserService('https://api.example.com');
  return service.fetchUser(id);
}

// ── Exported const ────────────────────────────────────────────────────────────

export const API_VERSION = '2.0';

// ── Default export ────────────────────────────────────────────────────────────

export default class ApiClient {
  constructor(private baseUrl: string) {}

  async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    return response.json() as Promise<T>;
  }
}

// ── Non-exported declarations ─────────────────────────────────────────────────

interface InternalConfig {
  timeout: number;
  retries: number;
}

type Callback<T> = (result: T) => void;

function parseConfig(raw: unknown): InternalConfig {
  return {
    timeout: 5000,
    retries: 3,
  };
}

const DEFAULT_CONFIG: InternalConfig = {
  timeout: 10000,
  retries: 5,
};

// ── Class with extends ────────────────────────────────────────────────────────

export class ExtendedRepository extends InMemoryRepository<UserProfile> {
  constructor() {
    super();
  }

  async findByRole(role: UserRole): Promise<UserProfile[]> {
    const all: UserProfile[] = [];
    // Simulating iteration over the items map
    return all.filter((u) => u.role === role);
  }
}

// ── Inline function call ──────────────────────────────────────────────────────

const defaultUser = createDefaultUser('Alice');
console.log('Default user:', defaultUser);
