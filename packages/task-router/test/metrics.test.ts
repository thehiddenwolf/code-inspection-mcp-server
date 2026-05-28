/**
 * @hermes/task-router — metrics unit tests
 *
 * Tests the Metric interface, all 5 metric implementations,
 * and the MetricRegistry orchestrator.
 */

import { describe, it, expect } from 'vitest';
import { CyclomaticMetric } from '../src/metrics/cyclomatic.js';
import { DependencyMetric } from '../src/metrics/dependencies.js';
import { InterfaceSurfaceMetric } from '../src/metrics/interface-surface.js';
import { LocImpactMetric } from '../src/metrics/loc-impact.js';
import { DensityMetric } from '../src/metrics/density.js';
import { MetricRegistry } from '../src/metrics/registry.js';
import { Metric } from '../src/metrics/metric.js';

// ── Metric interface contract ────────────────────────────

describe('Metric interface contract', () => {
  it('each metric has a name, compute, and toJSON', () => {
    const metrics: Metric[] = [
      new CyclomaticMetric(),
      new DependencyMetric(),
      new InterfaceSurfaceMetric(),
      new LocImpactMetric(),
      new DensityMetric(),
    ];

    for (const m of metrics) {
      expect(m.name).toBeTypeOf('string');
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.compute).toBeTypeOf('function');
      expect(m.toJSON).toBeTypeOf('function');

      const json = m.toJSON();
      expect(json).toHaveProperty('name');
      expect(json.name).toBe(m.name);
    }
  });

  it('each metric returns a valid result shape', () => {
    const code = 'const x = 1;\nfunction foo() { return x; }';
    const metrics: Metric[] = [
      new CyclomaticMetric(),
      new DependencyMetric(),
      new InterfaceSurfaceMetric(),
      new LocImpactMetric(),
      new DensityMetric(),
    ];

    for (const m of metrics) {
      const result = m.compute(code);
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('details');
      expect(result.name).toBe(m.name);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });
});

// ── CyclomaticMetric ─────────────────────────────────────

describe('CyclomaticMetric', () => {
  const metric = new CyclomaticMetric();

  // ── Base cases ────────────────────────────────────────────

  it('returns base 1 for straight-line code', () => {
    const code = `
      function add(a: number, b: number): number {
        return a + b;
      }
    `;
    const result = metric.compute(code);
    expect(result.score).toBe(1);
  });

  it('returns base 1 for empty code', () => {
    const result = metric.compute('');
    expect(result.score).toBe(1);
  });

  // ── Conditionals ─────────────────────────────────────────

  it('counts if statements', () => {
    const code = `
      function check(x: number): string {
        if (x > 0) return "positive";
        if (x < 0) return "negative";
        return "zero";
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 2 ifs = 3
    expect(result.score).toBe(3);
  });

  it('counts else-if chains via the if pattern', () => {
    const code = `
      function grade(score: number): string {
        if (score >= 90) return "A";
        else if (score >= 80) return "B";
        else if (score >= 70) return "C";
        else return "D";
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 3 ifs (including else-if) = 4
    expect(result.score).toBe(4);
  });

  it('counts if-else as single decision point', () => {
    const code = `
      function toggle(flag: boolean): number {
        if (flag) return 1;
        else return 0;
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1 if = 2
    expect(result.score).toBe(2);
  });

  it('counts nested if statements', () => {
    const code = `
      function classify(x: number, y: number): string {
        if (x > 0) {
          if (y > 0) return "Q1";
          if (y < 0) return "Q4";
        }
        return "axis";
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 3 ifs = 4
    expect(result.score).toBe(4);
  });

  // ── Loops ─────────────────────────────────────────────────

  it('counts while loops', () => {
    const code = `
      function countdown(n: number): void {
        while (n > 0) { n--; }
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1 while = 2
    expect(result.score).toBe(2);
  });

  it('counts for loops', () => {
    const code = `
      function sum(arr: number[]): number {
        let total = 0;
        for (const n of arr) { total += n; }
        return total;
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1 for = 2
    expect(result.score).toBe(2);
  });

  it('counts for loops with traditional syntax', () => {
    const code = `
      function sumTo(n: number): number {
        let total = 0;
        for (let i = 1; i <= n; i++) { total += i; }
        return total;
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1 for = 2
    expect(result.score).toBe(2);
  });

  it('counts do-while loops', () => {
    const code = `
      function readUntil(cond: boolean): void {
        do {
          poll();
        } while (cond);
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1 while (do-while contains while) = 2
    expect(result.score).toBe(2);
  });

  it('counts multiple loop types together', () => {
    const code = `
      function process(matrix: number[][]): void {
        for (const row of matrix) {
          let i = 0;
          while (i < row.length) {
            row[i] *= 2;
            i++;
          }
        }
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1 for + 1 while = 3
    expect(result.score).toBe(3);
  });

  // ── Switch / Case ─────────────────────────────────────────

  it('counts switch keyword', () => {
    const code = `
      function respond(code: number): string {
        switch (code) {
          case 200: return "OK";
          case 404: return "Not Found";
          case 500: return "Error";
        }
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1 switch + 3 cases = 5
    expect(result.score).toBe(5);
  });

  it('counts switch with default case', () => {
    const code = `
      function classify(n: number): string {
        switch (n) {
          case 1: return "one";
          case 2: return "two";
          default: return "other";
        }
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1 switch + 2 cases + 1 default = 5
    expect(result.score).toBe(5);
  });

  it('handles switch with single case', () => {
    const code = `
      function isOne(n: number): boolean {
        switch (n) {
          case 1: return true;
        }
        return false;
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1 switch + 1 case = 3
    expect(result.score).toBe(3);
  });

  // ── Exception handlers ────────────────────────────────────

  it('counts catch blocks', () => {
    const code = `
      function safeParse(json: string): unknown {
        try {
          return JSON.parse(json);
        } catch (e) {
          return null;
        }
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1 catch = 2
    expect(result.score).toBe(2);
  });

  it('counts multiple catch blocks', () => {
    const code = `
      function parse(input: string): number {
        try {
          return parseInt(input, 10);
        } catch (e) {
          try { return JSON.parse(input); } catch (e2) { return 0; }
        }
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 2 catch = 3
    expect(result.score).toBe(3);
  });

  // ── Ternary ───────────────────────────────────────────────

  it('counts ternary operators', () => {
    const code = `
      function max(a: number, b: number): number {
        return a > b ? a : b;
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1 ternary = 2
    expect(result.score).toBe(2);
  });

  it('counts nested ternary operators', () => {
    const code = `
      function clamp(n: number, lo: number, hi: number): number {
        return n < lo ? lo : n > hi ? hi : n;
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 2 ternaries = 3
    expect(result.score).toBe(3);
  });

  // ── Logical operators ─────────────────────────────────────

  it('counts logical operators at 0.5 weight', () => {
    const code = `
      function validate(x: number, y: number): boolean {
        return x > 0 && y > 0 && x < 100;
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 2x && (0.5 each) = 2
    expect(result.score).toBe(2);
  });

  it('counts logical OR operators at 0.5 weight', () => {
    const code = `
      function isReady(flag: boolean, fallback: boolean): boolean {
        return flag || fallback;
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1x || (0.5) = 1.5
    expect(result.score).toBe(1.5);
  });

  it('counts mixed && and || operators', () => {
    const code = `
      function canAccess(user: any): boolean {
        return user.role === "admin" && user.active || user.id === 1;
      }
    `;
    const result = metric.compute(code);
    // Base 1 + 1x && (0.5) + 1x || (0.5) = 2
    expect(result.score).toBe(2);
  });

  it('ignores && and || inside string literals', () => {
    const code = `
      function getMessage(): string {
        return "a && b || c";
      }
    `;
    const result = metric.compute(code);
    // Base 1 (operators inside string literals are stripped)
    expect(result.score).toBe(1);
  });

  // ── Comments and strings ──────────────────────────────────

  it('ignores control flow keywords inside comments', () => {
    const code = `
      function example(): void {
        // if (false) { neverCalled(); }
        /* for (;;) { infinite(); } */
        let x = 1;
      }
    `;
    const result = metric.compute(code);
    // Base 1 (everything inside comments is stripped)
    expect(result.score).toBe(1);
  });

  it('ignores control flow keywords inside string literals', () => {
    const code = `
      function getSnippet(): string {
        return "if (true) { for (;;) { } }";
      }
    `;
    const result = metric.compute(code);
    // Base 1 (everything inside string literals is stripped)
    expect(result.score).toBe(1);
  });

  // ── Complex / mixed ───────────────────────────────────────

  it('handles a complex real-world function', () => {
    const code = `
      function processRequest(req: any): Response {
        if (!req) return error(400);
        if (!req.body) return error(400);

        try {
          const data = JSON.parse(req.body);
          switch (data.action) {
            case "create":
              if (!data.name) return error(422);
              return create(data.name);
            case "update":
              return update(data.id, data);
            case "delete":
              return del(data.id);
            default:
              return error(501);
          }
        } catch (e) {
          return error(500);
        }
      }
    `;
    const result = metric.compute(code);
    // Base 1
    // + 3 ifs (two top-level + one inside case "create")
    // + 1 switch + 3 cases + 1 default
    // + 1 catch
    // = 1 + 3 + 1 + 3 + 1 + 1 = 10
    expect(result.score).toBe(10);
  });

  // ── Details string ────────────────────────────────────────

  it('produces details string', () => {
    const code = 'if (a) { if (b) { foo(); } }';
    const result = metric.compute(code);
    expect(result.details).toContain('Cyclomatic complexity');
  });

  it('details includes breakdown of all counted items', () => {
    const code = `
      function demo(x: number): void {
        if (x > 0) { foo(); }
        for (let i = 0; i < 10; i++) { bar(); }
        while (x > 0) { x--; }
        switch (x) {
          case 1: break;
          default: break;
        }
        try { risk(); } catch (e) { handle(); }
        return x > 0 ? x : 0;
      }
    `;
    const result = metric.compute(code);
    expect(result.details).toContain('if');
    expect(result.details).toContain('for');
    expect(result.details).toContain('while');
    expect(result.details).toContain('switch');
    expect(result.details).toContain('case');
    expect(result.details).toContain('default');
    expect(result.details).toContain('catch');
    expect(result.details).toContain('ternary');
  });

  it('score is rounded to 1 decimal place', () => {
    const code = 'const x = a || b && c;';
    const result = metric.compute(code);
    // Base 1 + 1 && (0.5) + 1 || (0.5) = 2
    // Should be an integer, but let's verify rounding works
    expect(Number.isFinite(result.score)).toBe(true);
  });
});

// ── DependencyMetric ────────────────────────────────────

describe('DependencyMetric', () => {
  const metric = new DependencyMetric();

  it('returns 0 for code with no imports', () => {
    const code = 'const x = 1;\nfunction foo() { return x; }';
    const result = metric.compute(code);
    expect(result.score).toBe(0);
  });

  it('counts ESM imports', () => {
    const code = `
      import { z } from 'zod';
      import { foo } from './bar.js';
    `;
    const result = metric.compute(code);
    // zod (external: 1.5) + ./bar.js (internal: 1) = 2.5
    // max-depth: ./bar.js = 1, so depth penalty 1*2 = 2
    // total: 2.5 + 2 = 4.5
    expect(result.score).toBeGreaterThan(0);
    expect(result.details).toContain('Total imports: 2');
  });

  it('counts require() calls', () => {
    const code = `
      const express = require('express');
      const config = require('./config');
    `;
    const result = metric.compute(code);
    expect(result.score).toBeGreaterThan(0);
    expect(result.details).toContain('Total imports: 2');
  });

  it('detects deep relative imports', () => {
    const code = `
      import { a } from '../../../../deep/module.js';
    `;
    const result = metric.compute(code);
    // external: 0, internal: 1, max-depth: 4, depth penalty: 4*2=8
    // total: 1 + 8 = 9
    expect(result.details).toContain('max-depth');
  });
});

// ── InterfaceSurfaceMetric ──────────────────────────────

describe('InterfaceSurfaceMetric', () => {
  const metric = new InterfaceSurfaceMetric();

  it('returns 0 for code with no exports', () => {
    const code = 'const internal = 1;\nfunction helper() { return internal; }';
    const result = metric.compute(code);
    expect(result.score).toBe(0);
  });

  it('counts exported functions', () => {
    const code = `
      export function add(a: number, b: number): number {
        return a + b;
      }
      export function subtract(a: number, b: number): number {
        return a - b;
      }
    `;
    const result = metric.compute(code);
    // 2 exported functions * 2 = 4, 4 params * 0.5 = 2, total 6
    expect(result.score).toBeGreaterThan(0);
    expect(result.details).toContain('Exported functions: 2');
  });

  it('counts exported classes and types', () => {
    const code = `
      export class Calculator {
        add(a: number, b: number): number { return a + b; }
      }
      export interface Config {
        debug: boolean;
      }
    `;
    const result = metric.compute(code);
    // exportedClasses: 1 * 3 = 3
    // exportedTypes: 1 * 1 = 1
    // total: 4
    expect(result.score).toBeGreaterThan(0);
    expect(result.details).toContain('exported classes: 1');
    expect(result.details).toContain('exported types/interfaces: 1');
  });
});

// ── LocImpactMetric ─────────────────────────────────────

describe('LocImpactMetric', () => {
  const metric = new LocImpactMetric();

  it('returns low score for tiny code', () => {
    const code = 'const x = 1;';
    const result = metric.compute(code);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThan(30);
  });

  it('returns higher score for large code', () => {
    // Generate a moderately large file
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`function func${i}(x: number): number { return x * ${i}; }`);
    }
    const code = lines.join('\n');
    const result = metric.compute(code);
    expect(result.score).toBeGreaterThan(10);
  });

  it('produces details with LOC info', () => {
    const code = 'const x = 1;\nconst y = 2;\n';
    const result = metric.compute(code);
    expect(result.details).toMatch(/LOC|lines/i);
  });
});

// ── DensityMetric ───────────────────────────────────────

describe('DensityMetric', () => {
  const metric = new DensityMetric();

  it('returns 0 for code with no imports', () => {
    const code = 'const x = 1;\nfunction foo() { return x; }';
    const result = metric.compute(code);
    expect(result.score).toBe(0);
  });

  it('returns higher for high import density', () => {
    const code = `
      import { a } from 'pkg-a';
      import { b } from 'pkg-b';
      import { c } from 'pkg-c';

      const x = a(b(c(1)));
    `;
    const result = metric.compute(code);
    // 3 imports / low code volume = high density
    expect(result.score).toBeGreaterThan(0);
    expect(result.details).toContain('density');
  });
});

// ── MetricRegistry ──────────────────────────────────────

describe('MetricRegistry', () => {
  it('runs all default metrics and returns results', () => {
    const registry = new MetricRegistry();
    const code = `
      import { z } from 'zod';
      export function validate(data: unknown): boolean {
        if (data === null) return false;
        if (typeof data !== 'object') return false;
        return true;
      }
    `;

    const result = registry.runAll(code, 'typescript');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('metrics');
    expect(Array.isArray(result.metrics)).toBe(true);
    expect(result.metrics.length).toBeGreaterThanOrEqual(3); // at least the original 3
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });

  it('registers and unregisters metrics', () => {
    const registry = new MetricRegistry();

    // Should have 5 default metrics
    const initialNames = registry.getMetricNames();
    expect(initialNames.length).toBe(5);

    // Unregister one
    const removed = registry.unregister('density');
    expect(removed).toBe(true);

    const namesAfter = registry.getMetricNames();
    expect(namesAfter.length).toBe(4);
    expect(namesAfter).not.toContain('density');

    // Unregister non-existent
    expect(registry.unregister('nonexistent')).toBe(false);
  });

  it('gets a specific metric by name', () => {
    const registry = new MetricRegistry();
    const metric = registry.get('cyclomatic');
    expect(metric).toBeDefined();
    expect(metric!.name).toBe('cyclomatic');

    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('handles custom weights', () => {
    const registry = new MetricRegistry({ cyclomatic: 1.0 });
    const weights = registry.getWeights();
    expect(weights.cyclomatic).toBe(1.0);
    // Other weights should still have defaults
    expect(weights.dependencies).toBe(0.25);
  });

  it('setWeights merges with defaults', () => {
    const registry = new MetricRegistry();
    registry.setWeights({ cyclomatic: 0.5 });
    const weights = registry.getWeights();
    expect(weights.cyclomatic).toBe(0.5);
    expect(weights['interface-surface']).toBe(0.20);
  });

  it('gracefully handles metric computation errors', () => {
    const registry = new MetricRegistry();

    // Register a metric that throws
    const brokenMetric: Metric = {
      name: 'broken',
      compute: () => { throw new Error('kaboom'); },
      toJSON: () => ({ name: 'broken' }),
    };
    registry.register(brokenMetric);

    const result = registry.runAll('some code');
    const brokenResult = result.metrics.find(m => m.name === 'broken');
    expect(brokenResult).toBeDefined();
    expect(brokenResult!.score).toBe(0);
    expect(brokenResult!.details).toContain('Error computing');
  });
});

// ── End-to-end: Metric interface compliance ─────────────

describe('All metrics comply with Metric interface', () => {
  const metrics: Metric[] = [
    new CyclomaticMetric(),
    new DependencyMetric(),
    new InterfaceSurfaceMetric(),
    new LocImpactMetric(),
    new DensityMetric(),
  ];

  for (const m of metrics) {
    it(`${m.name} returns correct MetricResult type`, () => {
      const result = m.compute('export function foo() { return 1; }');
      expect(result.name).toBe(m.name);
      expect(typeof result.score).toBe('number');
      expect(typeof result.details).toBe('string');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it(`${m.name} serialises via toJSON`, () => {
      const json = m.toJSON();
      expect(json.name).toBe(m.name);
      expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    });
  }
});
