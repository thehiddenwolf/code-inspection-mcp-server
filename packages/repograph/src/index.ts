#!/usr/bin/env node

/**
 * @hermes/repograph — RepoGraph MCP Server
 *
 * Provides tools for querying a codebase knowledge graph: finding definitions,
 * references, indexing files and projects, and exploring code structure via
 * an in-memory graph engine.
 *
 * Phase 3 implementation — full working MCP server with StdioServerTransport.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  McpToolDefinition,
  McpToolCallResult,
} from '@hermes/shared';
import { createLogger, PACKAGE_VERSION } from '@hermes/shared';

import { GraphEngine } from './graph-engine.js';
import { FileIndexer } from './file-indexer.js';
import type { IndexedFile, IndexedProject } from './file-indexer.js';
import type { QueryScope } from './types.js';
import { createGraphStore, loadEngineFromStore } from './graph-store.js';
import type { GraphStore } from './graph-store.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Logger
// ═══════════════════════════════════════════════════════════════════════════════

const log = createLogger('hermes-repograph');

// ═══════════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════════

const store: GraphStore = createGraphStore('.code-inpect-mcp/reprograph.db');
const graph = new GraphEngine();
const indexer = new FileIndexer(store);

// Track indexed files to avoid re-indexing
const indexedFiles = new Set<string>();
const fileHashes = new Map<string, string>();
let currentProjectRoot: string | undefined;

// ═══════════════════════════════════════════════════════════════════════════════
// Persistence helpers
// ═══════════════════════════════════════════════════════════════════════════════

function loadPersistedGraph(): void {
  try {
    const nodes = store.getAllNodes();
    const edges = store.getAllEdges();

    for (const node of nodes) graph.addNode(node);
    for (const edge of edges) {
      try { graph.addEdge(edge); } catch { /* stale edge */ }
    }

    // Restore indexed file tracking from store
    const storedProjectRoot = store.getMeta('projectRoot');
    if (storedProjectRoot) currentProjectRoot = storedProjectRoot;

    // Rebuild indexed file set from store — scan DB for files with nodes
    const allNodes = store.getAllNodes();
    const fileSet = new Set(allNodes.map((n) => n.filePath));
    for (const f of fileSet) indexedFiles.add(f);

    // Restore file hashes from store
    for (const f of fileSet) {
      const hash = store.getFileHash(f);
      if (hash) fileHashes.set(f, hash);
    }

    log.info('Loaded persisted graph', {
      nodes: graph.nodeCount,
      edges: graph.edgeCount,
      files: indexedFiles.size,
    });
  } catch (err) {
    log.warn('Could not load persisted graph (first run or corrupt store)', { err });
  }
}

function saveGraphState(): void {
  try {
    // Store project root as metadata
    if (currentProjectRoot) {
      store.setMeta('projectRoot', currentProjectRoot);
    }
    log.debug('Graph state synced to store', {
      nodes: graph.nodeCount,
      edges: graph.edgeCount,
    });
  } catch (err) {
    log.error('Failed to persist graph state', { err });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Definitions
// ═══════════════════════════════════════════════════════════════════════════════

interface ToolDef extends McpToolDefinition {
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

const TOOLS: ToolDef[] = [
  // ── repograph.query ───────────────────────────────────────────────────────
  {
    name: 'repograph.query',
    description: 'Query the codebase knowledge graph. Searches nodes by name/label and returns the connected subgraph via BFS traversal.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term to find in node IDs/labels',
        },
        file_path: {
          type: 'string',
          description: 'Optional file path to narrow the search scope',
        },
        scope: {
          type: 'string',
          enum: ['file', 'module', 'project'],
          description: 'Search scope — controls BFS depth (file=1, module=2, project=3)',
          default: 'project',
        },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const query = String(args.query ?? '');
      const filePath = args.file_path ? String(args.file_path) : undefined;
      const scope = (args.scope as QueryScope) ?? 'project';

      const result = graph.query({ query, filePath, scope });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                matched: result.nodes.length,
                nodes: result.nodes.map((n) => ({
                  id: n.id,
                  type: n.type,
                  label: n.label,
                  file: n.filePath,
                })),
                edges: result.edges.map((e) => ({
                  from: e.from,
                  to: e.to,
                  type: e.type,
                })),
                depths: result.depths,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },

  // ── repograph.index_file ──────────────────────────────────────────────────
  {
    name: 'repograph.index_file',
    description: 'Index a single source file into the knowledge graph. Extracts imports, exports, classes, functions, interfaces, and type declarations.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the source file to index',
        },
        content: {
          type: 'string',
          description: 'Optional file content. If omitted, the file will be read from disk.',
        },
      },
      required: ['file_path'],
    },
    handler: async (args) => {
      const filePath = String(args.file_path ?? '');
      const content = args.content ? String(args.content) : undefined;

      if (indexedFiles.has(filePath)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'already_indexed',
                file: filePath,
                message: `"${filePath}" is already in the graph. Re-indexing is not supported in v1.`,
              }, null, 2),
            },
          ],
        };
      }

      let fileContent: string;
      if (content) {
        fileContent = content;
      } else {
        try {
          const { readFileSync } = await import('node:fs');
          fileContent = readFileSync(filePath, 'utf-8');
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'error',
                  message: `Could not read file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }

      const indexed = indexer.indexFile(filePath, fileContent);
      const added = indexer.applyToGraph(graph, indexed);
      indexedFiles.add(filePath);

      // Persist to store
      const hash = FileIndexer.computeHash(fileContent);
      fileHashes.set(filePath, hash);
      store.recordIndexedFile(filePath, hash, indexed.nodes.length);
      for (const node of indexed.nodes) {
        try { store.insertNode(node); } catch { /* duplicate */ }
      }
      for (const edge of indexed.edges) {
        try { store.insertEdge(edge); } catch { /* duplicate */ }
      }
      saveGraphState();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'indexed',
                file: filePath,
                symbols_found: indexed.symbols.length,
                nodes_added: added,
                nodes: indexed.nodes.map((n) => ({
                  id: n.id,
                  type: n.type,
                  label: n.label,
                })),
                edges: indexed.edges.map((e) => ({
                  from: e.from,
                  to: e.to,
                  type: e.type,
                })),
                graph_totals: {
                  nodes: graph.nodeCount,
                  edges: graph.edgeCount,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },

  // ── repograph.index_project ───────────────────────────────────────────────
  {
    name: 'repograph.index_project',
    description: 'Index an entire project directory into the knowledge graph. Scans .ts, .tsx, .js, .jsx, .mjs, .cjs files.',
    inputSchema: {
      type: 'object',
      properties: {
        dir_path: {
          type: 'string',
          description: 'Root directory path of the project to index',
        },
      },
      required: ['dir_path'],
    },
    handler: async (args) => {
      const dirPath = String(args.dir_path ?? '');

      try {
        const { statSync } = await import('node:fs');
        if (!statSync(dirPath).isDirectory()) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'error',
                  message: `"${dirPath}" is not a directory or does not exist.`,
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                message: `Could not access directory "${dirPath}".`,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }

      const project = indexer.indexDirectory(dirPath);
      const stats = indexer.applyProjectToGraph(graph, project);
      currentProjectRoot = dirPath;

      // Track all indexed files
      for (const f of project.files) {
        indexedFiles.add(f.filePath);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'indexed',
                root: project.rootDir,
                files_indexed: project.files.length,
                total_symbols: project.totalSymbols,
                nodes_added: stats.nodesAdded,
                edges_added: stats.edgesAdded,
                files: project.files.map((f) => ({
                  path: f.filePath,
                  symbols: f.symbols.length,
                  nodes: f.nodes.length,
                })),
                graph_totals: {
                  nodes: graph.nodeCount,
                  edges: graph.edgeCount,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },

  // ── repograph.find_references ─────────────────────────────────────────────
  {
    name: 'repograph.find_references',
    description: 'Find all references to a symbol in the knowledge graph. Returns incoming import/call edges pointing to matching symbols.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Symbol name to search for references to',
        },
        project_path: {
          type: 'string',
          description: 'Optional project root — restricts results to this project',
        },
      },
      required: ['symbol'],
    },
    handler: async (args) => {
      const symbol = String(args.symbol ?? '');
      const projectPath = args.project_path ? String(args.project_path) : undefined;

      const results = graph.findReferences(symbol, projectPath);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                symbol,
                total_results: results.length,
                references: results.map((r) => ({
                  symbol_node: {
                    id: r.node.id,
                    type: r.node.type,
                    label: r.node.label,
                    file: r.node.filePath,
                  },
                  referrers: r.references.map((ref) => {
                    const fromNode = graph.getNode(ref.from);
                    return {
                      from: ref.from,
                      from_label: fromNode?.label ?? ref.from,
                      from_file: fromNode?.filePath ?? 'unknown',
                      type: ref.type,
                    };
                  }),
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },

  // ── repograph.find_definitions ────────────────────────────────────────────
  {
    name: 'repograph.find_definitions',
    description: 'Find the definition of a symbol in the knowledge graph. Searches for declaration-type nodes (class, function, interface, type, variable) matching the name.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Symbol name to find the definition of',
        },
        file_path: {
          type: 'string',
          description: 'Optional file path to narrow the search',
        },
      },
      required: ['symbol'],
    },
    handler: async (args) => {
      const symbol = String(args.symbol ?? '');
      const filePath = args.file_path ? String(args.file_path) : undefined;

      const definitions = graph.findDefinitions(symbol, filePath);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                symbol,
                definitions_found: definitions.length,
                definitions: definitions.map((d) => ({
                  id: d.id,
                  type: d.type,
                  label: d.label,
                  file: d.filePath,
                  metadata: d.metadata ?? {},
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Server
// ═══════════════════════════════════════════════════════════════════════════════

const SERVER_INFO = {
  name: 'hermes-repograph',
  version: PACKAGE_VERSION ?? '0.1.0',
};

function createServer(): Server {
  const server = new Server(SERVER_INFO, {
    capabilities: {
      tools: {},
    },
  });

  // ── tools/list ──────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  // ── tools/call ──────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
    const { name, arguments: args } = request.params;

    log.info('Tool call received', { tool: name });

    const toolDef = TOOLS.find((t) => t.name === name);
    if (!toolDef) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      } satisfies CallToolResult;
    }

    try {
      const result = await toolDef.handler(args ?? {});
      return result;
    } catch (err) {
      log.error('Tool handler error', { tool: name, err });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: name,
              message: err instanceof Error ? err.message : String(err),
            }, null, 2),
          },
        ],
        isError: true,
      } satisfies CallToolResult;
    }
  });

  return server;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Start
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  log.info('Starting RepoGraph MCP server with stdio transport');

  // Load persisted graph from previous sessions
  loadPersistedGraph();

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info('Hermes RepoGraph MCP server ready');
  log.info(`Registered ${TOOLS.length} tools`, { toolCount: TOOLS.length });
  for (const t of TOOLS) {
    log.debug(`  ${t.name}`, { tool: t.name });
  }
}

main().catch((err) => {
  log.error('Fatal error', { err });
  process.exit(1);
});
