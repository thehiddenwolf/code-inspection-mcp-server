import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from '@hermes/shared/utils/logging';

const log = createLogger('repograph:codebase-memory');

/**
 * Adapter for the Codebase-Memory MCP server.
 *
 * Codebase-Memory (https://github.com/nicholasgriffintn/codebase-memory)
 * is an MIT-licensed binary that provides sub-ms queries across 155 languages
 * using Tree-sitter. It exposes an MCP stdio interface.
 *
 * This adapter launches codebase-memory as a subprocess and communicates
 * via its stdio MCP protocol.
 */

export interface CmQueryResult {
  symbol: string;
  file: string;
  line: number;
  column: number;
  kind: string;
  score: number;
  context?: string;
}

export interface CmRelationship {
  from: { symbol: string; file: string };
  to: { symbol: string; file: string };
  relationship: string;
}

export interface CmGraphStats {
  symbols: number;
  files: number;
  relationships: number;
  languages: string[];
}

export class CodebaseMemoryAdapter {
  private process: ChildProcess | null = null;
  private buffer = '';
  private pendingResolve: ((data: string) => void) | null = null;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  private requestId = 0;
  private initialized = false;
  private binaryPath: string;

  constructor(binaryPath?: string) {
    // Try common install locations
    this.binaryPath =
      binaryPath ?? this.findBinary();
  }

  private findBinary(): string {
    const candidates = [
      'codebase-memory',
      path.join(process.env.HOME || '~', '.local', 'bin', 'codebase-memory'),
      '/usr/local/bin/codebase-memory',
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    // Not found — we'll still try to launch from PATH
    return 'codebase-memory';
  }

  /**
   * Start the codebase-memory subprocess.
   */
  async start(projectDir: string): Promise<void> {
    if (this.process) {
      log.info('Codebase-memory already running');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.binaryPath, [], {
          cwd: projectDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            CODEBASE_MEMORY_PROJECT_DIR: projectDir,
            CODEBASE_MEMORY_TRANSPORT: 'stdio',
          },
        });

        this.process.stdout?.on('data', (data: Buffer) => {
          this.handleData(data.toString());
        });

        this.process.stderr?.on('data', (data: Buffer) => {
          log.debug(`codebase-memory stderr: ${data.toString().trim()}`);
        });

        this.process.on('error', (err) => {
          log.error(`codebase-memory process error: ${err.message}`);
          this.process = null;
          reject(err);
        });

        this.process.on('exit', (code, signal) => {
          log.info(`codebase-memory exited (code=${code}, signal=${signal})`);
          this.process = null;
          this.initialized = false;
        });

        // Send initialize request
        this.sendRequest('initialize', {
          protocolVersion: '0.1.0',
          capabilities: {},
          clientInfo: {
            name: 'hermes-repograph',
            version: '0.1.0',
          },
        }).then(() => {
          this.initialized = true;
          log.info('Codebase-memory initialized');
          resolve();
        }).catch(reject);

        // Safety timeout
        setTimeout(() => {
          if (!this.initialized) {
            reject(new Error('Codebase-memory startup timed out after 10s'));
          }
        }, 10_000);
      } catch (err) {
        this.process = null;
        reject(err);
      }
    });
  }

  /**
   * Send a JSON-RPC request to codebase-memory.
   */
  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<any> {
    if (!this.process?.stdin?.writable) {
      // Fallback: return empty results if codebase-memory isn't running
      log.warn(`Codebase-memory not running, returning empty for "${method}"`);
      return this.emptyResponse(method);
    }

    const id = ++this.requestId;
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params: params ?? {},
    }) + '\n';

    this.process.stdin.write(request);

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingTimeout = setTimeout(() => {
        this.pendingResolve = null;
        reject(new Error(`Request "${method}" (id=${id}) timed out`));
      }, 30_000);
    });
  }

  private emptyResponse(method: string): any {
    if (method === 'tools/list') {
      return { tools: [] };
    }
    if (method === 'resources/list') {
      return { resources: [] };
    }
    return {};
  }

  /**
   * Handle incoming data from codebase-memory stdout.
   */
  private handleData(data: string): void {
    this.buffer += data;

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
        if (this.pendingResolve) {
          if (this.pendingTimeout) clearTimeout(this.pendingTimeout);
          this.pendingResolve(response);
          this.pendingResolve = null;
          this.pendingTimeout = null;
        }
      } catch {
        log.warn(`Failed to parse codebase-memory response: ${line.substring(0, 200)}`);
      }
    }
  }

  // ── High-level query methods ──────────────────────────────────────────────

  /**
   * Query the codebase for symbol definitions and references.
   */
  async querySymbol(query: string, limit = 20): Promise<CmQueryResult[]> {
    try {
      const result = await this.sendRequest('tools/call', {
        name: 'search',
        arguments: { query, limit },
      });

      return this.parseSearchResult(result);
    } catch (err) {
      log.warn(`Symbol query failed: ${err}`);
      return [];
    }
  }

  /**
   * Get relationships for a symbol (callers, callees, references).
   */
  async getRelationships(
    symbol: string,
    file?: string,
  ): Promise<CmRelationship[]> {
    try {
      const result = await this.sendRequest('tools/call', {
        name: 'get_relationships',
        arguments: { symbol, file },
      });

      return this.parseRelationshipResult(result);
    } catch (err) {
      log.warn(`Relationship query failed for "${symbol}": ${err}`);
      return [];
    }
  }

  /**
   * Rescan the project to rebuild its code graph.
   */
  async rescanProject(): Promise<CmGraphStats> {
    try {
      const result = await this.sendRequest('tools/call', {
        name: 'rescan',
        arguments: {},
      });

      return this.parseStatsResult(result);
    } catch (err) {
      log.warn(`Rescan failed: ${err}`);
      return { symbols: 0, files: 0, relationships: 0, languages: [] };
    }
  }

  /**
   * Get a summary of the graph database.
   */
  async getStats(): Promise<CmGraphStats> {
    try {
      const result = await this.sendRequest('tools/call', {
        name: 'get_stats',
        arguments: {},
      });

      return this.parseStatsResult(result);
    } catch (err) {
      log.warn(`Stats query failed: ${err}`);
      return { symbols: 0, files: 0, relationships: 0, languages: [] };
    }
  }

  // ── Result parsers ────────────────────────────────────────────────────────

  private parseSearchResult(result: any): CmQueryResult[] {
    if (result?.result?.content) {
      for (const item of result.result.content) {
        if (item.type === 'text') {
          try {
            return JSON.parse(item.text);
          } catch {
            // Not JSON — return as-is
          }
        }
      }
    }

    // Fallback: parse from response structure
    if (Array.isArray(result?.result)) {
      return result.result;
    }

    return [];
  }

  private parseRelationshipResult(result: any): CmRelationship[] {
    if (result?.result?.content) {
      for (const item of result.result.content) {
        if (item.type === 'text') {
          try {
            return JSON.parse(item.text);
          } catch {
            // Not JSON
          }
        }
      }
    }
    return [];
  }

  private parseStatsResult(result: any): CmGraphStats {
    const defaultStats: CmGraphStats = {
      symbols: 0,
      files: 0,
      relationships: 0,
      languages: [],
    };

    if (result?.result?.content) {
      for (const item of result.result.content) {
        if (item.type === 'text') {
          try {
            return { ...defaultStats, ...JSON.parse(item.text) };
          } catch {
            // Not JSON
          }
        }
      }
    }

    return defaultStats;
  }

  /**
   * Gracefully shut down the subprocess.
   */
  stop(): void {
    if (this.process) {
      try {
        this.process.stdin?.end();
        this.process.kill();
      } catch {
        // Already dead
      }
      this.process = null;
      this.initialized = false;
      log.info('Codebase-memory stopped');
    }
  }

  get isRunning(): boolean {
    return this.process !== null && this.initialized;
  }

  get binaryExists(): boolean {
    return fs.existsSync(this.binaryPath);
  }
}
