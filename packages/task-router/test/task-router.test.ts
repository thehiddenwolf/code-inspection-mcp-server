/**
 * @hermes/task-router — unit tests
 */

import { describe, it, expect } from 'vitest';
import { estimateComplexity, extractSubtasks } from '../src/estimator.js';
import { Analyzer } from '../src/analyzer.js';
import { Decomposer } from '../src/decomposer.js';
import { RoutingTable } from '../src/routing-table.js';

describe('TaskRouter', () => {
  // ── estimator ──────────────────────────────────────────────

  describe('estimateComplexity', () => {
    it('returns simple for a trivial task description', () => {
      const result = estimateComplexity('Fix the typo in the README file');
      expect(result.complexity).toBe('simple');
      expect(result.recommended_model).toBeDefined();
      expect(result.estimated_cost).toBeDefined();
      expect(result.estimated_tokens).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.reasoning).toBeDefined();
    });

    it('returns complex for a large architectural task description', () => {
      const result = estimateComplexity(
        'Design and implement a distributed microservice architecture for the platform. ' +
        'This involves creating a cross-cutting pipeline for authentication, ' +
        'orchestrating multiple services, and building a comprehensive infrastructure ' +
        'that scales across enterprise use cases. Migrate from the existing monolith ' +
        'with a multi-service approach. The system must handle end-to-end request ' +
        'tracing and distributed transaction coordination across the pipeline.'
      );
      expect(result.complexity).toBe('complex');
      expect(result.recommended_model).toBe('openai/gpt-4o');
      expect(result.estimated_cost).toContain('$');
    });

    it('returns medium for a moderately sized task', () => {
      // Build a description with ~100 words (medium range)
      const words = Array(100).fill('task').concat(['update', 'system']).join(' ');
      const result = estimateComplexity(words);
      expect(result.complexity).toBe('medium');
    });

    it('returns simple for a short description with simple keywords', () => {
      const result = estimateComplexity(
        'Minor cosmetic tweaks to the login page and bump the dependency version.'
      );
      expect(result.complexity).toBe('simple');
      expect(result.estimated_cost).toBe('< $0.01');
    });

    it('returns consistent structure for any input', () => {
      const result = estimateComplexity('');
      expect(result).toHaveProperty('complexity');
      expect(result).toHaveProperty('recommended_model');
      expect(result).toHaveProperty('estimated_cost');
      expect(result).toHaveProperty('estimated_tokens');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reasoning');
    });
  });

  // ── decomposer / extractSubtasks ───────────────────────────

  describe('extractSubtasks', () => {
    it('extracts subtasks from bullet-pointed list', () => {
      const description = [
        'Set up authentication middleware',
        '- Create JWT token generation',
        '- Implement refresh token logic',
        '- Add rate limiting',
      ].join('\n');

      const subtasks = extractSubtasks(description);
      expect(subtasks.length).toBeGreaterThanOrEqual(3);
      expect(subtasks[0]).toContain('JWT');
      expect(subtasks[1]).toContain('refresh');
    });

    it('extracts subtasks from numbered list', () => {
      const description = [
        'Steps to deploy:',
        '1. Build the Docker image',
        '2. Push to registry',
        '3. Update Kubernetes manifests',
      ].join('\n');

      const subtasks = extractSubtasks(description);
      expect(subtasks.length).toBeGreaterThanOrEqual(3);
      expect(subtasks[0]).toContain('Docker');
    });

    it('returns empty array for single-step description', () => {
      const subtasks = extractSubtasks('Just update the CSS file.');
      expect(subtasks).toEqual([]);
    });

    it('handles conjunction-based splitting when no list items', () => {
      const description = 'Set up the build pipeline and then configure the deployment and then verify everything works';
      const subtasks = extractSubtasks(description);
      expect(subtasks.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Analyzer ───────────────────────────────────────────────

  describe('Analyzer', () => {
    it('can analyze a simple code path', async () => {
      const analyzer = new Analyzer();
      const result = await analyzer.analyze({
        type: 'file',
        path: '/home/kerwin/code/hermes-mcp-toolset/packages/task-router/src/estimator.ts',
      });

      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('metrics');
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(result.total).toBeLessThanOrEqual(100);
    });

    it('throws for non-existent file', async () => {
      const analyzer = new Analyzer();
      await expect(
        analyzer.analyze({ type: 'file', path: 'non-existent-file.ts' })
      ).rejects.toThrow();
    });
  });

  // ── Decomposer ─────────────────────────────────────────────

  describe('Decomposer', () => {
    it('decomposes a plan into subtasks', async () => {
      const decomposer = new Decomposer();
      const result = await decomposer.decompose(
        'Create a user dashboard with login, profile editing, and settings pages.'
      );

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('subtasks');
      expect(Array.isArray(result.subtasks)).toBe(true);
    });
  });

  // ── RoutingTable ───────────────────────────────────────────

  describe('RoutingTable', () => {
    it('returns tier definition for a given score', () => {
      const table = new RoutingTable();
      const def = table.getTierDefinition(50);

      expect(def).toHaveProperty('tier');
      expect(def).toHaveProperty('recommendedModels');
      expect(def).toHaveProperty('guidance');
      expect(def.tier).toBeGreaterThanOrEqual(0);
      expect(def.tier).toBeLessThanOrEqual(5);
      expect(Array.isArray(def.recommendedModels)).toBe(true);
    });

    it('handles low scores', () => {
      const table = new RoutingTable();
      const def = table.getTierDefinition(5);
      expect(def.tier).toBeGreaterThanOrEqual(0);
    });

    it('handles high scores', () => {
      const table = new RoutingTable();
      const def = table.getTierDefinition(95);
      expect(def.tier).toBeGreaterThanOrEqual(0);
    });
  });
});
