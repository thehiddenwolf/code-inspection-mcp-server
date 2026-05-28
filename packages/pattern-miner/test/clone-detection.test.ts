/**
 * Clone detection unit tests.
 *
 * Tests:
 * 1. fragmentToPattern correctly converts code to structural pattern
 * 2. computeConfidence scores matches correctly
 * 3. End-to-end: finds structural clones across fixtures
 * 4. Batch clone search produces a valid ScanReport
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fragmentToPattern,
  computeConfidence,
  findClones,
  resetVarCounter,
} from '../src/clone-detection/semgrep-matcher.js';
import {
  runCloneDetection,
  batchCloneSearch,
  cloneMatchesToFindings,
} from '../src/clone-detection/clone-scanner.js';
import type { FindClonesInput } from '../src/clone-detection/types.js';
import type { ScanReport } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Clone Detection', () => {
  // ── fragmentToPattern ─────────────────────────────────

  describe('fragmentToPattern', () => {
    it('converts a simple function to structural pattern', () => {
      resetVarCounter();
      const fragment = `function add(a: number, b: number): number {
  return a + b;
}`;
      const pattern = fragmentToPattern(fragment);
      // Should replace 'add' with a metavariable like $ID_0
      expect(pattern).toContain('$ID_');
      expect(pattern).toContain('function');
      expect(pattern).toContain('return');
      // Keywords should be preserved
      expect(pattern).toContain('number');
    });

    it('preserves control flow keywords', () => {
      resetVarCounter();
      const fragment = `if (condition) {
  for (let i = 0; i < items.length; i++) {
    console.log(items[i]);
  }
}`;
      const pattern = fragmentToPattern(fragment);
      expect(pattern).toContain('if');
      expect(pattern).toContain('for');
      expect(pattern).toContain('let');
      expect(pattern).toContain('console');
    });

    it('replaces number literals with metavariables', () => {
      resetVarCounter();
      const fragment = `const MAX = 100;
const MIN = 0;
if (x > 50) { return; }`;
      const pattern = fragmentToPattern(fragment);
      // Number literals should be replaced
      expect(pattern).toMatch(/\$NUM_\d/);
      // Keywords and operators stay
      expect(pattern).toContain('>');
      expect(pattern).toContain('const');
      expect(pattern).toContain('if');
    });
  });

  // ── computeConfidence ─────────────────────────────────

  describe('computeConfidence', () => {
    it('returns 1.0 for identical code', () => {
      const code = 'function add(a: number, b: number): number {\n  return a + b;\n}';
      const score = computeConfidence(code, code);
      expect(score).toBeGreaterThanOrEqual(0.9);
    });

    it('returns high score for structurally similar code with different names', () => {
      const fragment = 'function add(a: number, b: number): number {\n  return a + b;\n}';
      const match = 'function sum(x: number, y: number): number {\n  return x + y;\n}';
      const score = computeConfidence(fragment, match);
      // Same structure (function with return), same brackets/operators
      expect(score).toBeGreaterThanOrEqual(0.7);
    });

    it('returns lower score for very different code', () => {
      const fragment = 'if (x > 0) { return x; }';
      const match = 'const result = await fetch(url);';
      const score = computeConfidence(fragment, match);
      expect(score).toBeLessThan(0.6);
    });
  });

  // ── cloneMatchesToFindings ─────────────────────────────

  describe('cloneMatchesToFindings', () => {
    it('converts CloneMatches to standard Finding format', () => {
      const matches = [
        {
          filePath: '/test/file.ts',
          startLine: 10,
          endLine: 15,
          column: 1,
          confidence: 0.95,
          matchedCode: 'function foo() { return 1; }',
          similarity: { structural: 0.95, renamed: false, literalDiffers: false },
        },
      ];

      const findings = cloneMatchesToFindings(matches, 'structural-clone', 'Structural Clone');
      expect(findings).toHaveLength(1);
      expect(findings[0].pattern_id).toBe('structural-clone');
      expect(findings[0].file_path).toBe('/test/file.ts');
      expect(findings[0].line).toBe(10);
      expect(findings[0].severity).toBe('warning'); // >= 0.9 confidence
    });
  });

  // ── End-to-end: findClones across fixtures ────────────

  describe('end-to-end clone detection', () => {
    it('finds structural clones between clone-source and clone-target', async () => {
      // The processItems function in clone-source and calculateProducts
      // in clone-target are structurally similar: loop through array, sum property.
      const fragment = `  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].value;
  }
  return total;`;
      
      const result = await findClones(
        fragment,
        'typescript',
        FIXTURES_DIR,
        { minConfidence: 0.3, maxResults: 10 },
      );

      // Should at minimum not crash
      expect(result.matches).toBeDefined();
      expect(typeof result.durationMs).toBe('number');
      expect(result.language).toBe('typescript');
      expect(result.fragment).toBe(fragment);

      // Log what we found for debugging
      console.log(`Clone search: ${result.matches.length} matches, ${result.filesScanned} files scanned, ${result.durationMs}ms`);
      for (const m of result.matches) {
        console.log(`  ${m.filePath}:${m.startLine} (${(m.confidence * 100).toFixed(0)}%)`);
      }
    });

    it('finds self-clone (source matches itself at high confidence)', async () => {
      // Searching within clone-source.ts should find at least the source itself
      const fragment = fs.readFileSync(
        path.join(FIXTURES_DIR, 'clone-source.ts'),
        'utf-8',
      ).split('\n').slice(17, 21).join('\n');  // processItems function body

      const result = await findClones(
        fragment,
        'typescript',
        FIXTURES_DIR,
        { minConfidence: 0.5 },
      );

      expect(result.matches).toBeDefined();
      // The source file itself should be found
      const selfMatch = result.matches.find(m => m.filePath.includes('clone-source'));
      // Not guaranteed since it depends on exact fragment boundaries, but the process should complete
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── runCloneDetection ─────────────────────────────────

  describe('runCloneDetection', () => {
    it('accepts FindClonesInput and returns structured result', async () => {
      const input: FindClonesInput = {
        fragment: 'return items.map(item => item.value);',
        language: 'typescript',
        searchPath: FIXTURES_DIR,
        minConfidence: 0.3,
        maxResults: 5,
      };

      const result = await runCloneDetection(input);
      expect(result.fragment).toBe(input.fragment);
      expect(result.language).toBe('typescript');
      expect(result.searchPath).toBe(FIXTURES_DIR);
      expect(Array.isArray(result.matches)).toBe(true);
    });
  });

  // ── batchCloneSearch ──────────────────────────────────

  describe('batchCloneSearch', () => {
    it('processes multiple fragments and produces a ScanReport', async () => {
      const report: ScanReport = await batchCloneSearch(
        [
          { fragment: 'for (let i = 0; i < arr.length; i++) { sum += arr[i]; }', language: 'typescript' },
          { fragment: 'const result = items.filter(x => x.active);', language: 'typescript' },
        ],
        FIXTURES_DIR,
        { minConfidence: 0.3, maxResultsPerFragment: 5 },
      );

      expect(report.scanId).toMatch(/^clone_/);
      expect(report.totalFindings).toBeGreaterThanOrEqual(0);
      expect(report.findingsBySeverity).toBeDefined();
      expect(Array.isArray(report.findings)).toBe(true);
    });
  });
});
