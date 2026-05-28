import { describe, it, expect, beforeEach } from 'vitest';
import { FileIndexer } from '../src/file-indexer.js';
import { GraphEngine } from '../src/graph-engine.js';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = resolve(__dirname, 'fixtures');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

describe('FileIndexer', () => {
  let indexer: FileIndexer;

  beforeEach(() => {
    indexer = new FileIndexer();
  });

  // ── indexFile ───────────────────────────────────────────────────────────

  describe('indexFile', () => {
    it('parses sample.ts and extracts symbols', () => {
      const content = readFixture('sample.ts');
      const result = indexer.indexFile('/test/sample.ts', content);

      // Should find several symbols
      expect(result.symbols.length).toBeGreaterThan(0);
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.edges.length).toBeGreaterThan(0);
    });

    it('extracts imports from sample.ts', () => {
      const content = readFixture('sample.ts');
      const result = indexer.indexFile('/test/sample.ts', content);

      // Check import edges pointing to the correct sources
      const importEdges = result.edges.filter((e) => e.type === 'imports');
      const importSources = importEdges
        .filter((e) => e.metadata?.names)
        .map((e) => e.metadata!.names as string[])
        .flat();

      expect(importSources).toContain('UserService');
      expect(importSources).toContain('UserProfile');
    });

    it('extracts exported interface declarations', () => {
      const content = readFixture('sample.ts');
      const result = indexer.indexFile('/test/sample.ts', content);

      const ifaces = result.symbols.filter(
        (s) => s.type === 'interface' && s.exported,
      );
      expect(ifaces.some((i) => i.name === 'Repository')).toBe(true);
    });

    it('extracts exported type aliases', () => {
      const content = readFixture('sample.ts');
      const result = indexer.indexFile('/test/sample.ts', content);

      const types = result.symbols.filter(
        (s) => s.type === 'type' && s.exported,
      );
      expect(types.some((t) => t.name === 'Result')).toBe(true);
    });

    it('extracts exported classes and functions', () => {
      const content = readFixture('sample.ts');
      const result = indexer.indexFile('/test/sample.ts', content);

      const classes = result.symbols.filter((s) => s.type === 'class' && s.exported);
      expect(classes.some((c) => c.name === 'InMemoryRepository')).toBe(true);

      const funcs = result.symbols.filter((s) => s.type === 'function' && s.exported);
      expect(funcs.some((f) => f.name === 'findUser')).toBe(true);

      // Exported const
      const vars = result.symbols.filter((s) => s.type === 'variable' && s.exported);
      expect(vars.some((v) => v.name === 'API_VERSION')).toBe(true);
    });

    it('extracts non-exported declarations too', () => {
      const content = readFixture('sample.ts');
      const result = indexer.indexFile('/test/sample.ts', content);

      const nonExported = result.symbols.filter((s) => !s.exported);
      expect(nonExported.length).toBeGreaterThan(0);
    });

    it('handles empty / trivial files', () => {
      const result = indexer.indexFile('/test/empty.ts', '');
      expect(result.symbols).toHaveLength(0);
      // File node is always present
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.type).toBe('file');
    });

    it('handles files with only a comment', () => {
      const result = indexer.indexFile('/test/comment.ts', '// just a comment\n/* block */');
      expect(result.symbols).toHaveLength(0);
      expect(result.nodes).toHaveLength(1);
    });

    it('extracts line and column numbers', () => {
      const content = readFixture('sample.ts');
      const result = indexer.indexFile('/test/sample.ts', content);

      const repository = result.symbols.find((s) => s.name === 'Repository');
      expect(repository).toBeDefined();
      expect(repository!.line).toBeGreaterThan(0);
      expect(repository!.column).toBeGreaterThan(0);
    });

    it('creates defines edges from file node to declarations', () => {
      const content = readFixture('sample.ts');
      const result = indexer.indexFile('/test/sample.ts', content);

      const definesEdges = result.edges.filter((e) => e.type === 'defines');
      expect(definesEdges.length).toBeGreaterThan(0);

      // Every defines edge should point from the file node
      for (const edge of definesEdges) {
        expect(edge.from).toBe('file:/test/sample.ts');
        expect(edge.to).toMatch(/^sym:/);
      }
    });
  });

  // ── indexDirectory ──────────────────────────────────────────────────────

  describe('indexDirectory', () => {
    it('indexes multiple files in a directory', () => {
      const project = indexer.indexDirectory(FIXTURES, FIXTURES);

      expect(project.files.length).toBeGreaterThanOrEqual(2);
      expect(project.totalSymbols).toBeGreaterThan(0);
      expect(project.totalNodes).toBeGreaterThan(0);
    });

    it('produces consistent IndexedProject structure', () => {
      const project = indexer.indexDirectory(FIXTURES, FIXTURES);

      expect(project.rootDir).toBe(FIXTURES);
      expect(project.totalSymbols).toBe(
        project.files.reduce((sum, f) => sum + f.symbols.length, 0),
      );
      expect(project.totalNodes).toBe(
        project.files.reduce((sum, f) => sum + f.nodes.length, 0),
      );
    });
  });

  // ── applyToGraph ────────────────────────────────────────────────────────

  describe('applyToGraph', () => {
    it('adds nodes and edges to a GraphEngine', () => {
      const graph = new GraphEngine();
      const content = readFixture('sample.ts');
      const indexed = indexer.indexFile('/test/sample.ts', content);

      const added = indexer.applyToGraph(graph, indexed);
      expect(added).toBe(indexed.nodes.length);
      expect(graph.nodeCount).toBe(indexed.nodes.length);
      expect(graph.edgeCount).toBeGreaterThan(0);
    });

    it('does not duplicate existing nodes', () => {
      const graph = new GraphEngine();
      const content = readFixture('sample.ts');
      const indexed = indexer.indexFile('/test/sample.ts', content);

      indexer.applyToGraph(graph, indexed);
      const added = indexer.applyToGraph(graph, indexed);
      expect(added).toBe(0); // all already exist
    });
  });

  // ── applyProjectToGraph ─────────────────────────────────────────────────

  describe('applyProjectToGraph', () => {
    it('adds all files from a project to the graph', () => {
      const graph = new GraphEngine();
      const project = indexer.indexDirectory(FIXTURES, FIXTURES);
      const stats = indexer.applyProjectToGraph(graph, project);

      expect(stats.nodesAdded).toBe(project.totalNodes);
      expect(stats.edgesAdded).toBeGreaterThan(0);
      expect(graph.nodeCount).toBe(project.totalNodes);
    });
  });
});
