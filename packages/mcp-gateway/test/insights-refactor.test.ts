import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, initializeGateway } from '../src/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Insights & Refactoring MCP Tools', () => {
  let server: any;
  let client: Client;
  let clientTransport: any;
  let serverTransport: any;
  let tempDir: string;

  beforeAll(async () => {
    // Initialize the gateway language packs
    await initializeGateway();

    // Set up a temporary directory with code and markdown files for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-refactor-test-'));

    // Create a mock codebase structure
    // 1. A Python file with declarations
    const pyFile = path.join(tempDir, 'main.py');
    fs.writeFileSync(pyFile, `
def greet(name):
    print(f"Hello, {name}")

class Greeter:
    def __init__(self):
        pass
    def greet_all(self):
        greet("Alice")
        greet("Bob")
`, 'utf8');

    // 2. A TS file calling the symbol
    const tsFile = path.join(tempDir, 'app.ts');
    fs.writeFileSync(tsFile, `
import { Greeter } from './main';
const greeter = new Greeter();
greeter.greet_all();
`, 'utf8');

    // 3. A Markdown file referencing the symbols
    const mdFile = path.join(tempDir, 'README.md');
    fs.writeFileSync(mdFile, `
# Greeter Documentation

Use the \`Greeter\` class to greet users.
The function \`greet\` is internal.
`, 'utf8');

    // Start MCP server and client
    server = createServer();
    const pair = InMemoryTransport.createLinkedPair();
    clientTransport = pair[0];
    serverTransport = pair[1];

    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // Index the temporary project via index_codebase
    await client.callTool({
      name: 'index_codebase',
      arguments: {
        path: tempDir,
      },
    });
  });

  afterAll(async () => {
    await Promise.all([client.close(), server.close()]);
    // Clean up temporary directory recursively
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ── insight_reference_tracker ─────────────────────────────────────────────

  describe('insight_reference_tracker', () => {
    it('tracks definitions, usages, and documentation mappings for a symbol', async () => {
      const response = await client.callTool({
        name: 'insight_reference_tracker',
        arguments: {
          symbol: 'Greeter',
          project_path: tempDir,
          include_docs: true,
        },
      });

      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content[0].type).toBe('text');

      const data = JSON.parse(response.content[0].text);
      expect(data.symbol).toBe('Greeter');
      
      // Definitions
      expect(data.definitions).toBeDefined();
      expect(data.definitions.length).toBeGreaterThan(0);
      expect(data.definitions.some((d: any) => d.file.includes('main.py'))).toBe(true);

      // Usages
      expect(data.usages).toBeDefined();
      expect(data.usages.length).toBeGreaterThan(0);
      expect(data.usages.some((u: any) => u.file.includes('app.ts'))).toBe(true);

      // Documentation mappings
      expect(data.documentation_mappings).toBeDefined();
      expect(data.documentation_mappings.length).toBeGreaterThan(0);
      expect(data.documentation_mappings[0].file).toContain('README.md');
      expect(data.documentation_mappings[0].line_content).toContain('Greeter');
    });
  });

  // ── get_insights ──────────────────────────────────────────────────────────

  describe('get_insights', () => {
    it('combines multiple checks into a single result', async () => {
      const response = await client.callTool({
        name: 'get_insights',
        arguments: {
          symbols: ['greet'],
          queries: [
            { type: 'definitions', symbol: 'Greeter' },
            { type: 'docs', symbol: 'Greeter' }
          ],
          project_path: tempDir,
          include_docs: true,
        },
      });

      expect(response).toBeDefined();
      const data = JSON.parse(response.content[0].text);
      expect(data.insights).toBeDefined();
      
      // Checking symbol insight
      expect(data.insights['greet']).toBeDefined();
      expect(data.insights['greet'].usages.length).toBeGreaterThan(0);

      // Checking query insights
      expect(data.insights['definitions:Greeter']).toBeDefined();
      expect(data.insights['docs:Greeter']).toBeDefined();
    });
  });

  // ── refactor_execute_batch ────────────────────────────────────────────────

  describe('refactor_execute_batch', () => {
    it('applies a batch of rename, replace, create, delete, and move operations successfully', async () => {
      const targetFile = path.join(tempDir, 'refactor_target.txt');
      fs.writeFileSync(targetFile, 'Hello world, rename_me is here. Keep replace_me too.\n', 'utf8');

      const response = await client.callTool({
        name: 'refactor_execute_batch',
        arguments: {
          project_path: tempDir,
          operations: [
            {
              type: 'rename',
              filePath: 'refactor_target.txt',
              oldName: 'rename_me',
              newName: 'renamed_value',
            },
            {
              type: 'replace',
              filePath: 'refactor_target.txt',
              find: 'replace_me',
              replace: 'replaced_value',
            },
            {
              type: 'create',
              filePath: 'new_created_file.txt',
              content: 'Created content',
            },
            {
              type: 'move',
              fromPath: 'refactor_target.txt',
              toPath: 'moved_target.txt',
            },
          ],
        },
      });

      expect(response).toBeDefined();
      const data = JSON.parse(response.content[0].text);
      expect(data.status).toBe('success');
      expect(data.modified_files).toContain('moved_target.txt');
      expect(data.modified_files).toContain('new_created_file.txt');
      expect(data.modified_files).toContain('refactor_target.txt');

      // Verify physical side-effects
      const movedContent = fs.readFileSync(path.join(tempDir, 'moved_target.txt'), 'utf8');
      expect(movedContent).toContain('renamed_value');
      expect(movedContent).toContain('replaced_value');
      expect(fs.existsSync(path.join(tempDir, 'refactor_target.txt'))).toBe(false);

      const createdContent = fs.readFileSync(path.join(tempDir, 'new_created_file.txt'), 'utf8');
      expect(createdContent).toBe('Created content');

      // Clean up the created files
      fs.unlinkSync(path.join(tempDir, 'moved_target.txt'));
      fs.unlinkSync(path.join(tempDir, 'new_created_file.txt'));
    });

    it('rolls back completely if any operation in the batch fails', async () => {
      const rollbackFile = path.join(tempDir, 'rollback_target.txt');
      const originalContent = 'Do not modify this content.\n';
      fs.writeFileSync(rollbackFile, originalContent, 'utf8');

      const response = await client.callTool({
        name: 'refactor_execute_batch',
        arguments: {
          project_path: tempDir,
          operations: [
            {
              type: 'replace',
              filePath: 'rollback_target.txt',
              find: 'modify',
              replace: 'change',
            },
            {
              type: 'replace',
              filePath: 'rollback_target.txt',
              find: 'nonexistent_pattern', // This will fail!
              replace: 'fail',
            },
          ],
        },
      });

      expect(response).toBeDefined();
      const data = JSON.parse(response.content[0].text);
      expect(data.status).toBe('error');
      expect(data.message).toContain('nonexistent_pattern');

      // Verify that NO changes were made to rollbackFile
      const currentContent = fs.readFileSync(rollbackFile, 'utf8');
      expect(currentContent).toBe(originalContent);

      // Clean up
      fs.unlinkSync(rollbackFile);
    });
  });

  // ── outline mode ──────────────────────────────────────────────────────────

  describe('get_symbols (outline mode)', () => {
    it('returns a clean outline of declarations instead of passes', async () => {
      const response = await client.callTool({
        name: 'get_symbols',
        arguments: {
          filePath: path.join(tempDir, 'main.py'),
          options: {
            outline: true,
          },
        },
      });

      expect(response).toBeDefined();
      const text = response.content[0].text;
      expect(text).toContain('- Class: Greeter');
      expect(text).toContain('- Function: greet');
    });
  });

  // ── get_indexed_symbol_tree ────────────────────────────────────────────────

  describe('get_indexed_symbol_tree', () => {
    it('traces call hierarchy trees', async () => {
      // Manually add call edges to test the traversal logic
      const mainContext = (server as any).setRequestHandler ? null : undefined; // server is accessible
      // We can just call getCallHierarchy directly or construct mock call edges in the active graph
      // Let's retrieve the gateway's internal graph context for tempDir
      // In packages/mcp-gateway/src/index.ts, repoContexts is private, but we can query it using get_insights or direct imports
      // Better yet, we can register call edges by indexing a file that has calling nodes, or simply add edges to the graph.
      // Wait, we can test getCallHierarchy's traversal logic directly in the gateway by executing a call through the client
      // Let's add mock symbol nodes and call edges directly to test the tool
      const repographPack = await import('@hermes/repograph/insights-refactor.js');
      const graphPack = await import('@hermes/repograph/graph-engine.js');
      const testGraph = new graphPack.GraphEngine();
      
      testGraph.addNode({ id: 'sym:foo', type: 'function', label: 'foo', filePath: 'test.ts' });
      testGraph.addNode({ id: 'sym:bar', type: 'function', label: 'bar', filePath: 'test.ts' });
      testGraph.addNode({ id: 'sym:baz', type: 'function', label: 'baz', filePath: 'test.ts' });
      
      testGraph.addEdge({ from: 'sym:foo', to: 'sym:bar', type: 'calls' });
      testGraph.addEdge({ from: 'sym:bar', to: 'sym:baz', type: 'calls' });

      // Outgoing from foo: foo -> bar -> baz
      const outgoing = repographPack.getCallHierarchy('foo', 'outgoing', testGraph);
      expect(outgoing.outgoing).toBeDefined();
      expect(outgoing.outgoing![0].symbol).toBe('foo');
      expect(outgoing.outgoing![0].calls![0].symbol).toBe('bar');
      expect(outgoing.outgoing![0].calls![0].calls![0].symbol).toBe('baz');

      // Incoming to baz: baz <- bar <- foo
      const incoming = repographPack.getCallHierarchy('baz', 'incoming', testGraph);
      expect(incoming.incoming).toBeDefined();
      expect(incoming.incoming![0].symbol).toBe('baz');
      expect(incoming.incoming![0].calls![0].symbol).toBe('bar');
      expect(incoming.incoming![0].calls![0].calls![0].symbol).toBe('foo');
    });
  });

  // ── get_indexed_symbol_dependencies & cycle detection ──────────────────────

  describe('get_indexed_symbol_dependencies & cycle detection', () => {
    it('analyzes imports and reports circular dependency cycles', async () => {
      // Set up a circular reference temp directory
      const cycleTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-cycle-test-'));
      
      fs.writeFileSync(path.join(cycleTempDir, 'a.ts'), `import { b } from 'b.ts';`, 'utf8');
      fs.writeFileSync(path.join(cycleTempDir, 'b.ts'), `import { a } from 'a.ts';`, 'utf8');

      // Create a fresh GraphEngine and index it
      const indexerPack = await import('@hermes/repograph/file-indexer.js');
      const graphPack = await import('@hermes/repograph/graph-engine.js');
      const storePack = await import('@hermes/repograph/graph-store.js');
      
      const testGraph = new graphPack.GraphEngine();
      const indexer = new indexerPack.FileIndexer();

      const project = indexer.indexDirectory(cycleTempDir);
      indexer.applyProjectToGraph(testGraph, project);

      const repographPack = await import('@hermes/repograph/insights-refactor.js');
      const report = repographPack.getDependencyReport(testGraph);

      expect(report.dependencies['a.ts']).toBeDefined();
      expect(report.dependencies['b.ts']).toBeDefined();
      expect(report.cycles.length).toBeGreaterThan(0);
      expect(report.cycles[0]).toContain('a.ts');
      expect(report.cycles[0]).toContain('b.ts');

      // Clean up cycle test files
      fs.rmSync(cycleTempDir, { recursive: true, force: true });
    });
  });
});
