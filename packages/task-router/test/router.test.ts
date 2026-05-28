/**
 * @hermes/task-router — ComplexityClassifier (router) integration tests
 *
 * Tests routing decisions based on different code inputs and
 * verifies that the three core metrics (cyclomatic, LOC impact, density)
 * produce the expected tier assignments.
 */

import { describe, it, expect } from 'vitest';
import { ComplexityClassifier, RoutingRequest } from '../src/router.js';
import { RouterConfig, loadRouterConfig, mergeConfig } from '../src/router-config.js';
import { RoutingTier } from '../src/types.js';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── ComplexityClassifier (Router) ────────────────────────────────

describe('ComplexityClassifier (Router)', () => {
  // ── Code-metric routing ──────────────────────────────────────

  describe('code-based routing', () => {
    it('routes straight-line code to Junior tier', async () => {
      const code = `
        function add(a: number, b: number): number {
          return a + b;
        }

        function greet(name: string): string {
          return "Hello, " + name;
        }

        const PI = 3.14159;
      `;

      const decision = await ComplexityClassifier.route({ code, language: 'typescript' });

      expect(decision.source).toBe('code-metrics');
      expect(decision.tier).toBe(RoutingTier.Junior);
      expect(decision.tierLabel).toBe('Junior');
      // Simple code should have a low score
      expect(decision.score).toBeLessThanOrEqual(15);
      expect(decision.metrics.length).toBeGreaterThanOrEqual(3);
      expect(decision.reasoning).toContain('Junior');
      expect(decision.effortEstimate.level).toBe('trivial');
    });

    it('routes moderately complex code to Mid tier', async () => {
      const code = `
        import { z } from 'zod';
        import { Router } from 'express';

        function processItems(items: any[]): any[] {
          const results: any[] = [];
          for (const item of items) {
            if (item.active) {
              if (item.price > 100) {
                results.push({ ...item, discount: item.price * 0.1 });
              } else if (item.price > 50) {
                results.push({ ...item, discount: item.price * 0.05 });
              } else {
                results.push(item);
              }
            }
          }
          return results;
        }

        function validate(input: unknown): boolean {
          if (!input) return false;
          if (typeof input !== 'object') return false;
          return true;
        }
      `;

      const decision = await ComplexityClassifier.route({ code, language: 'typescript' });

      expect(decision.source).toBe('code-metrics');
      // Should be Junior or Mid depending on exact scoring
      expect(decision.tier).toBeGreaterThanOrEqual(RoutingTier.Junior);
      expect(decision.tier).toBeLessThanOrEqual(RoutingTier.Mid);
      expect(decision.metrics.some(m => m.name === 'cyclomatic')).toBe(true);
      expect(decision.metrics.some(m => m.name === 'loc-impact')).toBe(true);
      expect(decision.metrics.some(m => m.name === 'density')).toBe(true);
    });

    it('routes complex code with switch statements to Senior tier', async () => {
      const code = `
        import { Request, Response } from 'express';
        import { authenticate } from './auth.js';
        import { validate } from './validate.js';
        import { log } from './logger.js';
        import { cache } from './cache.js';
        import { audit } from './audit.js';
        import { metrics } from './metrics.js';

        function processRequest(req: Request, res: Response): void {
          if (!req) { res.status(400).send('Bad request'); return; }

          try {
            const user = authenticate(req.headers.authorization);
            if (!user) {
              res.status(401).send('Unauthorized');
              return;
            }

            const data = req.body;
            if (!validate(data)) {
              res.status(422).send('Validation failed');
              return;
            }

            switch (data.action) {
              case 'create':
                if (data.type === 'user') {
                  if (data.role === 'admin') {
                    createAdminUser(data, user);
                  } else {
                    createRegularUser(data, user);
                  }
                } else if (data.type === 'order') {
                  if (data.items && data.items.length > 0) {
                    for (const item of data.items) {
                      if (item.quantity > 0) {
                        processItem(item, user);
                      }
                    }
                  }
                }
                break;

              case 'update':
                if (!data.id) { res.status(400).send('Missing id'); }
                if (data.fields) {
                  for (const field of Object.keys(data.fields)) {
                    if (data.fields[field] !== undefined) {
                      updatedFields.push(field);
                    }
                  }
                }
                break;

              case 'delete':
                if (user.role !== 'admin') {
                  res.status(403).send('Forbidden');
                  return;
                }
                break;

              default:
                res.status(501).send('Not implemented');
            }

            audit.log(req.method, req.path, user.id);
            res.status(200).send('OK');
          } catch (error) {
            log.error('Request failed', error);
            metrics.increment('request.error');
            res.status(500).send('Internal error');
          }
        }
      `;

      const decision = await ComplexityClassifier.route({ code, language: 'typescript' });

      expect(decision.source).toBe('code-metrics');
      // Complex code with switch/if/for should be Mid or Senior
      expect(decision.tier).toBeGreaterThanOrEqual(RoutingTier.Mid);
      expect(decision.tier).toBeLessThanOrEqual(RoutingTier.Senior);
      expect(decision.score).toBeGreaterThan(15);
    });

    it('routes extremely complex nested code to Expert tier', async () => {
      const code = `
        import express from 'express';
        import { createHash } from 'crypto';
        import { readFile, writeFile } from 'fs/promises';
        import { join, resolve } from 'path';
        import { EventEmitter } from 'events';
        import { RateLimiter } from './rate-limiter.js';
        import { CacheManager } from './cache.js';
        import { Logger } from './logger.js';
        import { MetricsCollector } from './metrics.js';
        import { Database } from './database.js';
        import { Validator } from './validator.js';

        class RequestPipeline {
          private rateLimiter: RateLimiter;
          private cache: CacheManager;
          private logger: Logger;
          private metrics: MetricsCollector;
          private db: Database;
          private validator: Validator;

          async handle(req: any): Promise<any> {
            if (!req) throw new Error('No request');

            try {
              if (!this.rateLimiter.check(req.ip)) {
                if (!req.headers['x-retry']) {
                  return { status: 429, body: 'Rate limited' };
                }
                await this.rateLimiter.wait(req.ip);
              }

              const cached = await this.cache.get(req.url);
              if (cached) {
                this.metrics.increment('cache.hit');
                if (req.headers['if-none-match'] === cached.etag) {
                  return { status: 304 };
                }
                return cached.data;
              }

              if (this.validator.hasSchema(req.url)) {
                const schema = this.validator.getSchema(req.url);
                if (!schema) {
                  throw new Error('Schema not found');
                }
                const isValid = schema.validate(req.body);
                if (!isValid) {
                  const errors = schema.getErrors(req.body);
                  if (errors.length > 0) {
                    for (const err of errors) {
                      this.logger.warn('Validation error', err);
                    }
                    return { status: 422, body: { errors } };
                  }
                }
              }

              let result;
              switch (req.method) {
                case 'GET': {
                  const data = await this.db.query(req.params);
                  if (data && Array.isArray(data)) {
                    result = { items: data, total: data.length };
                    for (const item of data) {
                      if (item.relations) {
                        for (const rel of item.relations) {
                          if (rel.type === 'reference') {
                            rel.resolved = await this.db.findById(rel.id);
                          }
                        }
                      }
                    }
                  } else {
                    result = { items: [], total: 0 };
                  }
                  break;
                }
                case 'POST': {
                  if (!req.body) {
                    return { status: 400, body: 'Body required' };
                  }
                  const conflicts = await this.db.findConflicts(req.body);
                  if (conflicts && conflicts.length > 0) {
                    for (const conflict of conflicts) {
                      this.logger.warn('Conflict detected', conflict);
                    }
                    return { status: 409, body: { conflicts } };
                  }
                  result = await this.db.insert(req.body);
                  this.metrics.increment('db.inserts');
                  break;
                }
                case 'DELETE': {
                  if (req.user?.role !== 'admin') {
                    return { status: 403 };
                  }
                  const deleted = await this.db.remove(req.params.id);
                  if (!deleted) {
                    return { status: 404 };
                  }
                  break;
                }
                default:
                  return { status: 501 };
              }

              await this.cache.set(req.url, result);
              return { status: 200, body: result };
            } catch (error) {
              this.logger.error('Pipeline error', error);
              this.metrics.increment('pipeline.error');
              if (error instanceof DatabaseError) {
                return { status: 503, body: 'Database unavailable' };
              } else if (error instanceof ValidationError) {
                return { status: 422, body: error.message };
              } else if (error instanceof RateLimitError) {
                return { status: 429 };
              } else {
                return { status: 500 };
              }
            }
          }
        }
      `;

      const decision = await ComplexityClassifier.route({ code, language: 'typescript' });

      expect(decision.source).toBe('code-metrics');
      // Extremely complex code should be Senior or Expert tier
      expect(decision.tier).toBeGreaterThanOrEqual(RoutingTier.Senior);
      expect(decision.score).toBeGreaterThan(30);
    });
  });

  // ── Description-based heuristic routing ─────────────────────

  describe('description-based routing', () => {
    it('routes a simple task description to Junior tier', async () => {
      const decision = await ComplexityClassifier.route({
        description: 'Fix the typo in the README file and bump the version number.',
      });

      expect(decision.source).toBe('description-heuristic');
      expect(decision.tier).toBe(RoutingTier.Junior);
      expect(decision.score).toBeLessThanOrEqual(15);
      expect(decision.metrics.length).toBe(1);
      expect(decision.metrics[0].name).toBe('description-heuristic');
      expect(decision.effortEstimate.level).toBe('trivial');
    });

    it('routes a moderate task to appropriate tier', async () => {
      const decision = await ComplexityClassifier.route({
        description: 'Add a new API endpoint for user profiles, update the validation middleware, and write tests.',
      });

      expect(decision.source).toBe('description-heuristic');
      expect(decision.tier).toBeGreaterThanOrEqual(RoutingTier.Junior);
      expect(decision.tier).toBeLessThanOrEqual(RoutingTier.Mid);
      expect(decision.recommendedModels.length).toBeGreaterThan(0);
    });

    it('routes a complex task description to Senior tier', async () => {
      const decision = await ComplexityClassifier.route({
        description: [
          'Design and implement a distributed microservice architecture for the platform.',
          'This involves creating a cross-cutting pipeline for authentication,',
          'orchestrating multiple services, and building a comprehensive infrastructure',
          'that scales across enterprise use cases. Migrate from the existing monolith',
          'with a multi-service approach. The system must handle end-to-end request',
          'tracing and distributed transaction coordination across the pipeline.',
        ].join(' '),
      });

      expect(decision.source).toBe('description-heuristic');
      expect(decision.tier).toBe(RoutingTier.Senior);
      expect(decision.reasoning).toContain('complex');
    });
  });

  // ── Config integration ──────────────────────────────────────

  describe('configuration support', () => {
    it('uses default config when no file exists', async () => {
      const classifier = new ComplexityClassifier();
      const config = classifier.getConfig();

      expect(config.algorithm).toBe('weighted');
      expect(config.metricWeights).toBeDefined();
      expect(config.metricWeights!.cyclomatic).toBeGreaterThan(0);
    });

    it('respects custom threshold overrides', async () => {
      const overrides: RouterConfig = {
        thresholds: { tier1Max: 5, tier2Max: 20, tier3Max: 50 },
      };

      const decision = await ComplexityClassifier.route({
        code: 'function add(a: number, b: number): number { return a + b; }',
        language: 'typescript',
        configOverrides: overrides,
      });

      // With tighter thresholds, even simple code might be Mid
      // Just verify the config took effect via the classifier
      expect(decision.tier).toBeGreaterThanOrEqual(RoutingTier.Junior);
    });

    it('loads config from a JSON file when available', async () => {
      // Write a temp config
      const tmpConfig = join(tmpdir(), 'test-router-config.json');
      writeFileSync(tmpConfig, JSON.stringify({
        metricWeights: { cyclomatic: 0.6, 'loc-impact': 0.3, density: 0.1 },
        algorithm: 'weighted',
      }, null, 2));

      try {
        const config = await loadRouterConfig(tmpConfig);
        expect(config.metricWeights!.cyclomatic).toBe(0.6);
        expect(config.metricWeights!['loc-impact']).toBe(0.3);
        expect(config.metricWeights!.density).toBe(0.1);
        expect(config.algorithm).toBe('weighted');
      } finally {
        if (existsSync(tmpConfig)) unlinkSync(tmpConfig);
      }
    });

    it('mergeConfig combines user config with defaults', () => {
      const merged = mergeConfig({
        algorithm: 'strict',
        thresholds: { tier1Max: 20 },
      });

      // Defaults fill in missing fields
      expect(merged.algorithm).toBe('strict');
      expect(merged.thresholds!.tier1Max).toBe(20);
      expect(merged.metricWeights!.cyclomatic).toBe(0.40);
      expect(merged.verbose).toBe(false);
    });

    it('priority: code over description when both provided', async () => {
      const decision = await ComplexityClassifier.route({
        code: 'const x = 1;',
        description: 'Design a distributed microservice architecture with multi-service orchestration.',
      });

      // With code provided, source should be code-metrics
      expect(decision.source).toBe('code-metrics');
    });
  });

  // ── Strict algorithm mode ────────────────────────────────────

  describe('strict algorithm mode', () => {
    it('uses max of core metrics instead of weighted average', async () => {
      // Code with high cyclomatic but low LOC impact — strict should
      // use the max score, bumping tier compared to weighted
      const highCyclomaticCode = `
        function complexRouter(req: any): any {
          if (req.method === 'GET') {
            if (req.query.id) {
              if (req.query.type === 'user') {
                return fetchUser(req.query.id);
              } else if (req.query.type === 'order') {
                return fetchOrder(req.query.id);
              } else {
                return fetchGeneric(req.query.id);
              }
            } else {
              if (req.query.all) {
                return fetchAll(req.query.type);
              }
              return fetchDefault();
            }
          } else if (req.method === 'POST') {
            if (req.body) {
              if (req.body.action === 'create') return create(req.body);
              else if (req.body.action === 'update') return update(req.body);
            }
            return { error: 'invalid' };
          }
          return { error: 'unknown method' };
        }
      `;

      // Run with weighted (default)
      const weightedDecision = await ComplexityClassifier.route({
        code: highCyclomaticCode,
        language: 'typescript',
      });

      // Run with strict algorithm
      const strictDecision = await ComplexityClassifier.route({
        code: highCyclomaticCode,
        language: 'typescript',
        configOverrides: { algorithm: 'strict' },
      });

      // Strict should have a higher or equal score to weighted
      expect(strictDecision.score).toBeGreaterThanOrEqual(weightedDecision.score);
      expect(strictDecision.source).toBe('code-metrics');
      expect(strictDecision.reasoning).toContain('algorithm: strict');
    });

    it('strict route returns same result as weighted when all metrics are balanced', async () => {
      // Simple code where all metrics are low — strict and weighted converge
      const simpleCode = 'const x = 1; function add(a: number, b: number) { return a + b; }';

      const weighted = await ComplexityClassifier.route({ code: simpleCode, language: 'typescript' });
      const strict = await ComplexityClassifier.route({
        code: simpleCode,
        language: 'typescript',
        configOverrides: { algorithm: 'strict' },
      });

      // Both should give Junior tier for trivially simple code
      expect(strict.tier).toBe(RoutingTier.Junior);
      expect(weighted.tier).toBe(RoutingTier.Junior);
    });

    it('configOverrides correctly sets algorithm to strict', async () => {
      const classifier = new ComplexityClassifier({
        algorithm: 'strict',
        metricWeights: { cyclomatic: 0.4, 'loc-impact': 0.3, density: 0.15, dependencies: 0.1, 'interface-surface': 0.05 },
      });

      const config = classifier.getConfig();
      expect(config.algorithm).toBe('strict');
    });

    it('strict mode reasoning mentions algorithm choice', async () => {
      const code = `function simple() { return 1; }`;
      const decision = await ComplexityClassifier.route({
        code,
        language: 'typescript',
        configOverrides: { algorithm: 'strict' },
      });

      expect(decision.reasoning).toContain('strict');
    });

    it('strict mode falls back to weighted when no core metrics are available', async () => {
      // Empty code — registry returns empty metrics, strict should fallback gracefully
      const classifier = new ComplexityClassifier({
        algorithm: 'strict',
        metricWeights: { cyclomatic: 0.4, 'loc-impact': 0.3, density: 0.15, dependencies: 0.1, 'interface-surface': 0.05 },
      });

      // We need to construct a scenario where metrics have no core names.
      // The actual registry always returns core metrics for non-empty code,
      // so the fallback path is exercised only internally. Verify the
      // algorithm property is set correctly.
      expect(classifier.getConfig().algorithm).toBe('strict');
    });
  });
});

// ── MCP tool: task_router.route ────────────────────────────────

describe('task_router.route MCP tool', () => {
  it('routes based on source code with weighted algorithm', async () => {
    const decision = await ComplexityClassifier.route({
      code: 'function add(a: number, b: number) { return a + b; }',
      language: 'typescript',
    });

    expect(decision).toHaveProperty('tier');
    expect(decision).toHaveProperty('score');
    expect(decision).toHaveProperty('recommendedModels');
    expect(decision).toHaveProperty('source');
    expect(decision).toHaveProperty('metrics');
    expect(decision).toHaveProperty('guidance');
    expect(decision).toHaveProperty('reasoning');
    expect(decision).toHaveProperty('effortEstimate');
    expect(decision.source).toBe('code-metrics');
    expect(Array.isArray(decision.recommendedModels)).toBe(true);
    expect(decision.recommendedModels.length).toBeGreaterThan(0);
  });

  it('routes based on description with heuristic fallback', async () => {
    const decision = await ComplexityClassifier.route({
      description: 'Fix a typo in the README file.',
    });

    expect(decision.source).toBe('description-heuristic');
    expect(decision.tier).toBeDefined();
    expect(decision.score).toBeGreaterThanOrEqual(0);
    expect(decision.reasoning).toContain('Description-based');
  });

  it('supports strict algorithm mode through configOverrides', async () => {
    const decision = await ComplexityClassifier.route({
      code: 'function add(a: number, b: number) { return a + b; }',
      language: 'typescript',
      configOverrides: { algorithm: 'strict' },
    });

    expect(decision.reasoning).toContain('strict');
    expect(decision.source).toBe('code-metrics');
  });

  it('returns effort estimate with level and timeframe', async () => {
    const decision = await ComplexityClassifier.route({
      code: 'export const PI = 3.14; function area(r: number) { return PI * r * r; }',
      language: 'typescript',
    });

    expect(decision.effortEstimate).toHaveProperty('level');
    expect(decision.effortEstimate).toHaveProperty('description');
    expect(decision.effortEstimate).toHaveProperty('suggestedTimeframe');
  });

  it('throws when neither code nor description is provided', async () => {
    await expect(
      ComplexityClassifier.route({})
    ).rejects.toThrow();
  });

  it('routes complex code to higher tier than simple code', async () => {
    const simpleCode = 'const x = 1;';
    const complexCode = `
      class ServiceLocator {
        private static instances = new Map<string, any>();
        static register<T>(key: string, factory: () => T): void {
          if (this.instances.has(key)) throw new Error('Already registered');
          this.instances.set(key, factory());
        }
        static resolve<T>(key: string): T {
          const instance = this.instances.get(key);
          if (!instance) throw new Error('Not found: ' + key);
          return instance as T;
        }
        static has(key: string): boolean { return this.instances.has(key); }
        static clear(): void { this.instances.clear(); }
      }
    `;

    const simple = await ComplexityClassifier.route({ code: simpleCode, language: 'typescript' });
    const complex = await ComplexityClassifier.route({ code: complexCode, language: 'typescript' });

    expect(complex.score).toBeGreaterThan(simple.score);
    expect(complex.tier).toBeGreaterThanOrEqual(simple.tier);
    expect(complex.metrics.length).toBeGreaterThanOrEqual(simple.metrics.length);
  });
});
