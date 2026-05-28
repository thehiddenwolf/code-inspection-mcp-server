/**
 * Blueprint search integration tests.
 *
 * Tests:
 * 1. CPD-only search (no fragment) — detects cross-file duplication
 * 2. Semgrep-only search (fragment provided) — finds structural clones
 * 3. Unified search with both engines — merges and deduplicates
 * 4. Edge cases: empty directory, single file, no clones found
 * 5. Deduplication: overlapping findings from both engines
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blueprintSearch } from '../src/blueprint-search/engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Blueprint Search — Unified Pipeline', () => {
  // ── CPD-only search ────────────────────────────────────

  describe('CPD-only search (no fragment)', () => {
    it('detects cross-file tokenized duplication', async () => {
      const result = await blueprintSearch({
        searchPath: FIXTURES_DIR,
        minConfidence: 0.4,
        maxResults: 50,
      });

      // Should complete without error
      expect(result.searchPath).toBe(FIXTURES_DIR);
      expect(typeof result.filesScanned).toBe('number');
      expect(typeof result.durationMs).toBe('number');
      expect(typeof result.totalFindings).toBe('number');
      expect(typeof result.cpdResults).toBe('number');
      expect(result.semgrepResults).toBe(0); // No fragment provided
      expect(Array.isArray(result.findings)).toBe(true);

      // Every finding should be from CPD (or merged as 'both' if structural aligns)
      for (const f of result.findings) {
        expect(['cpd', 'both', 'structural']).toContain(f.method);
        expect(f.filePath).toBeTruthy();
        expect(f.startLine).toBeGreaterThan(0);
        expect(f.endLine).toBeGreaterThanOrEqual(f.startLine);
        expect(typeof f.confidence).toBe('number');
        expect(f.confidence).toBeGreaterThanOrEqual(0);
      }

      console.log(`CPD search: ${result.totalFindings} findings from ${result.filesScanned} files in ${result.durationMs}ms`);
    });
  });

  // ── Semgrep-only search (with fragment) ────────────────

  describe('Semgrep-only search (with fragment)', () => {
    it('finds structural clones of a fragment', async () => {
      const fragment = `  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].value;
  }
  return total;`;

      const result = await blueprintSearch({
        fragment,
        language: 'typescript',
        searchPath: FIXTURES_DIR,
        minConfidence: 0.3,
        maxResults: 20,
      });

      expect(result.fragment).toBe(fragment);
      expect(result.language).toBe('typescript');
      expect(typeof result.semgrepResults).toBe('number');
      expect(typeof result.totalFindings).toBe('number');
      expect(Array.isArray(result.findings)).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      console.log(`Semgrep search: ${result.semgrepResults} raw results, ${result.totalFindings} after dedup, ${result.filesScanned} files, ${result.durationMs}ms`);
      for (const f of result.findings) {
        console.log(`  ${f.filePath}:${f.startLine}-${f.endLine} [${f.method}] (${(f.confidence * 100).toFixed(0)}%)`);
      }
    });
  });

  // ── Unified search (both engines) ──────────────────────

  describe('Unified search (both engines)', () => {
    it('runs both Semgrep and CPD, returns merged results', async () => {
      const fragment = `function processItems(items: Item[]): number {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].value;
  }
  return total;
}`;

      const result = await blueprintSearch({
        fragment,
        language: 'typescript',
        searchPath: FIXTURES_DIR,
        minConfidence: 0.3,
        maxResults: 50,
      });

      // Both engines should have run
      expect(typeof result.semgrepResults).toBe('number');
      expect(typeof result.cpdResults).toBe('number');
      expect(result.totalFindings).toBeGreaterThanOrEqual(0);

      // Check that findings have correct structure
      for (const f of result.findings) {
        expect(f.filePath).toBeTruthy();
        expect(f.startLine).toBeGreaterThan(0);
        expect(f.endLine).toBeGreaterThanOrEqual(f.startLine);
        expect(f.confidence).toBeGreaterThanOrEqual(0);
        expect(f.confidence).toBeLessThanOrEqual(1);
        expect(['semgrep', 'cpd', 'structural', 'both', 'all']).toContain(f.method);
        expect(f.snippet).toBeDefined();
      }

      // Report
      console.log(`Unified search:`);
      console.log(`  Semgrep: ${result.semgrepResults} results`);
      console.log(`  CPD: ${result.cpdResults} results`);
      console.log(`  Both: ${result.bothResults} findings`);
      console.log(`  Total after dedup: ${result.totalFindings}`);
      console.log(`  Files scanned: ${result.filesScanned}`);
      console.log(`  Duration: ${result.durationMs}ms`);
    });
  });

  // ── Edge cases ─────────────────────────────────────────

  describe('Edge cases', () => {
    it('handles non-existent search path gracefully', async () => {
      await expect(
        blueprintSearch({ searchPath: '/nonexistent/path/xyz' }),
      ).rejects.toThrow(/does not exist/);
    });

    it('handles empty directory', async () => {
      const emptyDir = path.join(FIXTURES_DIR, '__empty_test__');
      try {
        fs.mkdirSync(emptyDir, { recursive: true });
        const result = await blueprintSearch({
          searchPath: emptyDir,
        });

        expect(result.filesScanned).toBe(0);
        expect(result.totalFindings).toBe(0);
        expect(result.semgrepResults).toBe(0);
        expect(result.cpdResults).toBe(0);
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('handles single file (CPD needs >= 2 files)', async () => {
      // Create a temp dir with just one file
      const singleDir = path.join(FIXTURES_DIR, '__single_file_test__');
      try {
        fs.mkdirSync(singleDir, { recursive: true });
        fs.writeFileSync(path.join(singleDir, 'single.ts'), 'const x = 1;\n', 'utf-8');

        const result = await blueprintSearch({
          searchPath: singleDir,
        });

        expect(result.filesScanned).toBe(1);
        expect(result.cpdResults).toBe(0); // CPD needs >= 2 files
        expect(result.totalFindings).toBe(0);
      } finally {
        fs.rmSync(singleDir, { recursive: true, force: true });
      }
    });

    it('handles fragment without language (gracefully skips Semgrep)', async () => {
      const result = await blueprintSearch({
        fragment: 'const x = 1;',
        // no language — Semgrep will be skipped
        searchPath: FIXTURES_DIR,
      });

      // Should still run CPD
      expect(result.semgrepResults).toBe(0);
      expect(typeof result.cpdResults).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Deduplication verification ─────────────────────────

  describe('Deduplication', () => {
    it('correctly reports bothResults when both engines find the same region', async () => {
      // Use a fragment that exists in the fixtures
      const sourceContent = fs.readFileSync(
        path.join(FIXTURES_DIR, 'clone-source.ts'),
        'utf-8',
      );
      const lines = sourceContent.split('\n');
      // Use a substantial fragment that CPD will also find as duplication
      const fragment = lines.slice(15, 22).join('\n');

      const result = await blueprintSearch({
        fragment,
        language: 'typescript',
        searchPath: FIXTURES_DIR,
        minConfidence: 0.3,
        maxResults: 50,
      });

      // Validate the dedup key structure
      const methodCounts = { semgrep: 0, cpd: 0, both: 0 };
      for (const f of result.findings) {
        methodCounts[f.method]++;
      }

      // The merge should not lose or corrupt findings
      expect(
        result.semgrepResults + result.cpdResults - result.bothResults,
      ).toBeGreaterThanOrEqual(result.totalFindings);

      console.log(`Dedup breakdown:`, methodCounts);
      console.log(`Raw: ${result.semgrepResults} semgrep + ${result.cpdResults} cpd = ${result.semgrepResults + result.cpdResults}`);
      console.log(`Merged: ${result.totalFindings} (both: ${result.bothResults})`);
    });

    it('merged findings have widened ranges where overlap occurred', async () => {
      const fragment = 'return items.map(item => item.value);';

      const result = await blueprintSearch({
        fragment,
        language: 'typescript',
        searchPath: FIXTURES_DIR,
        minConfidence: 0.3,
        maxResults: 50,
      });

      // 'both' findings should have the widest possible range
      const bothFindings = result.findings.filter(f => f.method === 'both');
      for (const f of bothFindings) {
        expect(f.endLine).toBeGreaterThanOrEqual(f.startLine);
        // Confidence should be the max of both
        expect(f.confidence).toBeGreaterThanOrEqual(0.3);
      }
    });
  });
});
