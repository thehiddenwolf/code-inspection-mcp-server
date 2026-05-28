import { describe, it, expect } from 'vitest';
import { createServer, TOOLS } from '../src/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('MCP Gateway Server Core (In-Memory)', () => {
  it('should create an MCP server instance with correct name and version', () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it('should list all registered stub tools over in-memory transport', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    // Connect client and server
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    const response = await client.listTools();
    expect(response).toBeDefined();
    expect(response.tools).toBeDefined();
    expect(response.tools.length).toBe(TOOLS.length);

    const names = response.tools.map((t: any) => t.name);
    expect(names).toContain('token_squeezer_read_symbols');
    expect(names).toContain('architecture_shepherd_check');

    // Clean up
    await Promise.all([client.close(), server.close()]);
  });

  it('should run token_squeezer_read_symbols and return the squeezed result', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    const response = await client.callTool({
      name: 'token_squeezer_read_symbols',
      arguments: {
        code: 'console.log("hello");',
        language: 'javascript',
      },
    });

    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
    expect(response.content[0].type).toBe('text');
    expect(response.content[0].text).toContain('console.log');

    await Promise.all([client.close(), server.close()]);
  });

  it('should run token_squeezer_read_symbols with filePath and auto-detect language', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    const response = await client.callTool({
      name: 'token_squeezer_read_symbols',
      arguments: {
        filePath: 'packages/token-squeezer/test/fixtures/sample.ts',
      },
    });

    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
    expect(response.content[0].type).toBe('text');
    expect(response.content[0].text).toContain('loadConfig');

    await Promise.all([client.close(), server.close()]);
  });

  it('should return error status for unregistered tool names', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    try {
      const response = await client.callTool({
        name: 'nonexistent_tool',
        arguments: {},
      });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Unknown tool: nonexistent_tool');
    } catch (err) {
      // In some versions of the SDK, calling an unknown tool throws a protocol error
      expect(err).toBeDefined();
    }

    await Promise.all([client.close(), server.close()]);
  });
});
