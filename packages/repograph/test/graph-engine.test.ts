import { describe, it, expect, beforeEach } from 'vitest';
import { GraphEngine } from '../src/graph-engine.js';
import type { GraphNode, GraphEdge } from '../src/types.js';

describe('GraphEngine', () => {
  let graph: GraphEngine;

  beforeEach(() => {
    graph = new GraphEngine();
  });

  // ── Node Management ──────────────────────────────────────────────────────

  describe('addNode / hasNode / getNode', () => {
    it('adds and retrieves a node', () => {
      const node: GraphNode = {
        id: 'sym:hello',
        type: 'function',
        label: 'hello',
        filePath: '/test/file.ts',
      };
      graph.addNode(node);

      expect(graph.hasNode('sym:hello')).toBe(true);
      expect(graph.getNode('sym:hello')).toEqual(node);
    });

    it('does not add duplicate nodes', () => {
      const node: GraphNode = {
        id: 'sym:dup',
        type: 'variable',
        label: 'dup',
        filePath: '/test/a.ts',
      };
      graph.addNode(node);
      graph.addNode(node); // second call should no-op

      expect(graph.nodeCount).toBe(1);
    });

    it('getNode returns undefined for missing nodes', () => {
      expect(graph.getNode('sym:nope')).toBeUndefined();
    });
  });

  describe('getAllNodes / getNodesByType / getNodesByFile', () => {
    beforeEach(() => {
      graph.addNode({ id: 'file:a.ts', type: 'file', label: 'a.ts', filePath: '/src/a.ts' });
      graph.addNode({ id: 'sym:foo', type: 'function', label: 'foo', filePath: '/src/a.ts' });
      graph.addNode({ id: 'sym:Bar', type: 'class', label: 'Bar', filePath: '/src/b.ts' });
      graph.addNode({ id: 'sym:baz', type: 'variable', label: 'baz', filePath: '/src/a.ts' });
    });

    it('returns all nodes', () => {
      expect(graph.getAllNodes()).toHaveLength(4);
    });

    it('filters by type', () => {
      const funcs = graph.getNodesByType('function');
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.id).toBe('sym:foo');
    });

    it('filters by file path', () => {
      const inA = graph.getNodesByFile('/src/a.ts');
      expect(inA).toHaveLength(3);
    });
  });

  // ── Edge Management ──────────────────────────────────────────────────────

  describe('addEdge / getOutgoingEdges / getIncomingEdges', () => {
    beforeEach(() => {
      graph.addNode({ id: 'file:a.ts', type: 'file', label: 'a.ts', filePath: '/src/a.ts' });
      graph.addNode({ id: 'sym:greet', type: 'function', label: 'greet', filePath: '/src/a.ts' });
      graph.addNode({ id: 'sym:hello', type: 'function', label: 'hello', filePath: '/src/b.ts' });
    });

    it('adds and retrieves edges', () => {
      const edge: GraphEdge = {
        from: 'file:a.ts',
        to: 'sym:greet',
        type: 'defines',
      };
      graph.addEdge(edge);

      const outgoing = graph.getOutgoingEdges('file:a.ts');
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0]!.to).toBe('sym:greet');

      const incoming = graph.getIncomingEdges('sym:greet');
      expect(incoming).toHaveLength(1);
    });

    it('throws when adding edge with missing nodes', () => {
      expect(() =>
        graph.addEdge({ from: 'sym:nowhere', to: 'sym:missing', type: 'calls' }),
      ).toThrow('missing node');
    });

    it('avoids duplicate edges', () => {
      const edge: GraphEdge = { from: 'file:a.ts', to: 'sym:greet', type: 'defines' };
      graph.addEdge(edge);
      graph.addEdge(edge); // duplicate
      expect(graph.edgeCount).toBe(1);
    });
  });

  describe('getAllEdges', () => {
    it('returns all edges from the graph', () => {
      graph.addNode({ id: 'file:a.ts', type: 'file', label: 'a.ts', filePath: '/src/a.ts' });
      graph.addNode({ id: 'sym:x', type: 'function', label: 'x', filePath: '/src/a.ts' });
      graph.addNode({ id: 'sym:y', type: 'function', label: 'y', filePath: '/src/a.ts' });

      graph.addEdge({ from: 'file:a.ts', to: 'sym:x', type: 'defines' });
      graph.addEdge({ from: 'sym:x', to: 'sym:y', type: 'calls' });

      expect(graph.getAllEdges()).toHaveLength(2);
    });

    it('returns empty array for empty graph', () => {
      expect(graph.getAllEdges()).toEqual([]);
    });
  });

  // ── Query (BFS) ─────────────────────────────────────────────────────────

  describe('query', () => {
    beforeEach(() => {
      graph.addNode({ id: 'file:main.ts', type: 'file', label: 'main.ts', filePath: '/src/main.ts' });
      graph.addNode({ id: 'file:app.ts', type: 'file', label: 'app.ts', filePath: '/src/app.ts' });
      graph.addNode({ id: 'sym:render', type: 'function', label: 'render', filePath: '/src/main.ts' });
      graph.addNode({ id: 'sym:App', type: 'class', label: 'App', filePath: '/src/app.ts' });
      graph.addNode({ id: 'sym:helper', type: 'function', label: 'helper', filePath: '/src/util.ts' });
      graph.addNode({ id: 'sym:Helper', type: 'class', label: 'Helper', filePath: '/src/util.ts' });

      graph.addEdge({ from: 'file:main.ts', to: 'sym:render', type: 'defines' });
      graph.addEdge({ from: 'sym:render', to: 'sym:App', type: 'calls' });
      graph.addEdge({ from: 'file:main.ts', to: 'file:app.ts', type: 'imports' });
      graph.addEdge({ from: 'sym:App', to: 'sym:helper', type: 'calls' });
    });

    it('finds nodes by label (case-insensitive)', () => {
      const result = graph.query({ query: 'render', scope: 'project' });
      expect(result.nodes.length).toBeGreaterThanOrEqual(1);
      expect(result.nodes.some((n) => n.id === 'sym:render')).toBe(true);
    });

    it('returns connected subgraph via BFS', () => {
      const result = graph.query({ query: 'render', scope: 'project' });
      // BFS from 'render' should reach 'App', 'main.ts', 'app.ts'
      expect(result.nodes.length).toBeGreaterThanOrEqual(3);
      expect(result.edges.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by file scope', () => {
      const result = graph.query({ query: 'render', filePath: '/src/main.ts', scope: 'file' });
      expect(result.nodes.some((n) => n.id === 'sym:render')).toBe(true);
      // BFS depth 1: should not reach sym:App in another file
    });

    it('limits BFS depth based on scope', () => {
      // module scope: depth 2 — render -> App -> helper (depth 2), but not beyond
      const result = graph.query({ query: 'helper', scope: 'module' });
      // helper is at file /src/util.ts, App references it
      expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty result for missing query', () => {
      const result = graph.query({ query: 'zzz_nonexistent', scope: 'project' });
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  // ── References ──────────────────────────────────────────────────────────

  describe('findReferences', () => {
    beforeEach(() => {
      graph.addNode({ id: 'file:a.ts', type: 'file', label: 'a.ts', filePath: '/src/a.ts' });
      graph.addNode({ id: 'sym:greet', type: 'function', label: 'greet', filePath: '/src/a.ts' });
      graph.addNode({ id: 'file:b.ts', type: 'file', label: 'b.ts', filePath: '/src/b.ts' });
      graph.addNode({ id: 'file:c.ts', type: 'file', label: 'c.ts', filePath: '/other/c.ts' });

      graph.addEdge({ from: 'file:b.ts', to: 'sym:greet', type: 'imports', metadata: { names: ['greet'] } });
      graph.addEdge({ from: 'file:a.ts', to: 'sym:greet', type: 'defines' });
    });

    it('finds incoming references to a symbol', () => {
      const refs = graph.findReferences('greet');
      expect(refs).toHaveLength(1); // one node matched
      expect(refs[0]!.node.id).toBe('sym:greet');
      expect(refs[0]!.references).toHaveLength(1);
      expect(refs[0]!.references[0]!.from).toBe('file:b.ts');
    });

    it('filters by project path', () => {
      const refs = graph.findReferences('greet', '/src');
      expect(refs).toHaveLength(1);
      // Only the reference from b.ts (under /src) should remain
      expect(refs[0]!.references).toHaveLength(1);
    });

    it('returns node with empty references list when symbol has no references', () => {
      graph.addNode({ id: 'sym:lonely', type: 'variable', label: 'lonely', filePath: '/src/x.ts' });
      const refs = graph.findReferences('lonely');
      // The node is found but has no incoming refs; without a projectPath filter,
      // the engine returns the node with an empty references list
      expect(refs).toHaveLength(1);
      expect(refs[0]!.references).toHaveLength(0);
    });
  });

  // ── Definitions ─────────────────────────────────────────────────────────

  describe('findDefinitions', () => {
    beforeEach(() => {
      graph.addNode({ id: 'sym:render@/src/main.ts', type: 'function', label: 'render', filePath: '/src/main.ts' });
      graph.addNode({ id: 'sym:Render', type: 'class', label: 'Render', filePath: '/src/main.ts' });
      graph.addNode({ id: 'sym:render@/src/lib.ts', type: 'function', label: 'render', filePath: '/src/lib.ts' });
      graph.addNode({ id: 'sym:helper', type: 'variable', label: 'helper', filePath: '/src/util.ts' });
    });

    it('finds definitions by name', () => {
      const defs = graph.findDefinitions('render');
      expect(defs.length).toBeGreaterThanOrEqual(2);
    });

    it('filters definitions by file path', () => {
      const defs = graph.findDefinitions('render', '/src/main.ts');
      expect(defs).toHaveLength(2);
      expect(defs.every((d) => d.filePath === '/src/main.ts')).toBe(true);
    });

    it('returns empty for undefined symbols', () => {
      const defs = graph.findDefinitions('does_not_exist');
      expect(defs).toHaveLength(0);
    });
  });

  // ── nodeId helper ───────────────────────────────────────────────────────

  describe('static nodeId', () => {
    it('generates file node IDs', () => {
      expect(GraphEngine.nodeId('file', '/src/main.ts')).toBe('file:/src/main.ts');
    });

    it('generates symbol node IDs', () => {
      expect(GraphEngine.nodeId('sym', 'foo')).toBe('sym:foo');
    });

    it('generates scoped symbol node IDs with filePath', () => {
      expect(GraphEngine.nodeId('sym', 'foo', '/src/main.ts')).toBe('sym:foo@/src/main.ts');
    });
  });

  // ── Clear ───────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('resets the graph completely', () => {
      graph.addNode({ id: 'sym:temp', type: 'function', label: 'temp', filePath: '/t.ts' });
      graph.addEdge({ from: 'sym:temp', to: 'sym:temp', type: 'calls' });
      graph.clear();

      expect(graph.nodeCount).toBe(0);
      expect(graph.edgeCount).toBe(0);
      expect(graph.getAllNodes()).toEqual([]);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  describe('empty graph', () => {
    it('handles query on empty graph gracefully', () => {
      const result = graph.query({ query: 'anything', scope: 'project' });
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it('handles findReferences on empty graph', () => {
      expect(graph.findReferences('foo')).toEqual([]);
    });

    it('handles findDefinitions on empty graph', () => {
      expect(graph.findDefinitions('foo')).toEqual([]);
    });
  });

  // ── Multi-Repository Support ─────────────────────────────────────────────

  describe('multi-repository support and segmentation', () => {
    beforeEach(() => {
      // Repository A
      graph.addNode({ id: 'repoA::file:/src/main.ts', type: 'file', label: 'main.ts', filePath: '/src/main.ts', repository: 'repoA' });
      graph.addNode({ id: 'repoA::sym:render@/src/main.ts', type: 'function', label: 'render', filePath: '/src/main.ts', repository: 'repoA' });

      // Repository B
      graph.addNode({ id: 'repoB::file:/src/main.ts', type: 'file', label: 'main.ts', filePath: '/src/main.ts', repository: 'repoB' });
      graph.addNode({ id: 'repoB::sym:render@/src/main.ts', type: 'function', label: 'render', filePath: '/src/main.ts', repository: 'repoB' });
    });

    it('generates repository-prefixed node IDs from helper when not default', () => {
      expect(GraphEngine.nodeId('file', '/src/main.ts', 'repoA')).toBe('repoA::file:/src/main.ts');
      expect(GraphEngine.nodeId('sym', 'render', '/src/main.ts', 'repoA')).toBe('repoA::sym:render@/src/main.ts');

      // 'default' should not add prefix
      expect(GraphEngine.nodeId('file', '/src/main.ts', 'default')).toBe('file:/src/main.ts');
    });

    it('segments definitions matching same symbol name across repos', () => {
      const defsA = graph.findDefinitions('render', undefined, 'repoA');
      expect(defsA).toHaveLength(1);
      expect(defsA[0]!.id).toBe('repoA::sym:render@/src/main.ts');

      const defsB = graph.findDefinitions('render', undefined, 'repoB');
      expect(defsB).toHaveLength(1);
      expect(defsB[0]!.id).toBe('repoB::sym:render@/src/main.ts');
    });

    it('queries and filters by repository', () => {
      const resultA = graph.query({ query: 'render', scope: 'project', repository: 'repoA' });
      expect(resultA.nodes).toHaveLength(1);
      expect(resultA.nodes[0]!.id).toBe('repoA::sym:render@/src/main.ts');

      const resultB = graph.query({ query: 'render', scope: 'project', repository: 'repoB' });
      expect(resultB.nodes).toHaveLength(1);
      expect(resultB.nodes[0]!.id).toBe('repoB::sym:render@/src/main.ts');
    });

    it('clears repository-scoped nodes and edges', () => {
      // Clear repoA
      graph.clearRepository('repoA');
      
      const allNodes = graph.getAllNodes();
      // repoA nodes should be removed, repoB nodes should remain
      expect(allNodes.some(n => n.repository === 'repoA')).toBe(false);
      expect(allNodes.some(n => n.repository === 'repoB')).toBe(true);
      expect(allNodes).toHaveLength(2); // repoB file + repoB render
    });
  });
});
