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
import { createGraphStore, loadEngineFromStore, computeFileHash } from './graph-store.js';
import type { GraphStore } from './graph-store.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════════
// Logger
// ═══════════════════════════════════════════════════════════════════════════════

const log = createLogger('hermes-repograph');

// ═══════════════════════════════════════════════════════════════════════════════
// State & Multi-Repo Context Support
// ═══════════════════════════════════════════════════════════════════════════════

interface RepoContext {
  store: GraphStore;
  graph: GraphEngine;
  indexer: FileIndexer;
  indexedFiles: Set<string>;
  fileHashes: Map<string, string>;
  currentProjectRoot: string | undefined;
}

const repoContexts = new Map<string, RepoContext>();
let lastActiveRoot = path.resolve(process.cwd());

function findProjectRoot(startPath: string): string {
  let current = path.resolve(startPath);
  try {
    const stat = fs.statSync(current);
    if (!stat.isDirectory()) {
      current = path.dirname(current);
    }
  } catch {
    if (path.extname(current)) {
      current = path.dirname(current);
    }
  }

  while (true) {
    const hermesDir = path.join(current, '.code-inspect-mcp');
    const gitDir = path.join(current, '.git');
    if (fs.existsSync(hermesDir) || fs.existsSync(gitDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.resolve(startPath);
}

function getRepoContext(targetPath?: string): RepoContext {
  const root = targetPath ? findProjectRoot(targetPath) : lastActiveRoot;
  lastActiveRoot = root;

  let context = repoContexts.get(root);
  if (!context) {
    log.info(`Initializing RepoGraph context for root: ${root}`);
    const dbPath = path.join(root, '.code-inspect-mcp', 'repograph.db');
    const store = createGraphStore(dbPath);
    const graph = new GraphEngine();
    const indexer = new FileIndexer(store);
    const indexedFiles = new Set<string>();
    const fileHashes = new Map<string, string>();
    let currentProjectRoot: string | undefined = root;

    // Load persisted graph
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

      // Rebuild indexed file set from store
      const allNodes = store.getAllNodes();
      const fileSet = new Set(allNodes.map((n) => n.filePath));
      for (const f of fileSet) indexedFiles.add(f);

      // Restore file hashes from store
      for (const f of fileSet) {
        const hash = store.getFileHash(f);
        if (hash) fileHashes.set(f, hash);
      }

      log.info(`Loaded persisted graph for ${root}`, {
        nodes: graph.nodeCount,
        edges: graph.edgeCount,
        files: indexedFiles.size,
      });
    } catch (err) {
      log.warn(`Could not load persisted graph for ${root} (first run or corrupt store)`, { err });
    }

    context = { store, graph, indexer, indexedFiles, fileHashes, currentProjectRoot };
    repoContexts.set(root, context);
  }
  return context;
}

function saveGraphState(context: RepoContext): void {
  try {
    if (context.currentProjectRoot) {
      context.store.setMeta('projectRoot', context.currentProjectRoot);
    }
    log.debug('Graph state synced to store', {
      nodes: context.graph.nodeCount,
      edges: context.graph.edgeCount,
    });
  } catch (err) {
    log.error('Failed to persist graph state', { err });
  }
}

interface CodeReference {
  file: string;
  class_or_table: string;
  method: string;
  line_number: number;
  line_of_code: string;
}

function findCodeReferences(
  query: string,
  root: string,
  indexedFiles: Set<string>,
): CodeReference[] {
  const refs: CodeReference[] = [];
  const symbolWordRe = new RegExp(`\\b${query}\\b`);
  const declRe = new RegExp(`\\b(?:class|interface|struct|record|enum|def|function|sub|table|view|procedure)\\s+${query}\\b`, 'i');

  for (const relPath of indexedFiles) {
    const fullPath = path.join(root, relPath);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split(/\r?\n/);

      let currentClassOrTable = 'None';
      let currentMethod = 'None';

      const ext = path.extname(relPath).toLowerCase();
      const isSql = ext === '.sql';
      const isPython = ext === '.py';
      const isVb = ext === '.vb';
      const isJsTsCs = ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx' || ext === '.cs';

      const jstscsClassRe = /(?:class|interface|struct|record)\s+(\w+)/i;
      const jstscsMethodRe = /\b(?!if|for|while|catch|switch|using)(\w+)\s*\(([^)]*)\)\s*(?:\{|=>|;)/i;

      const pyClassRe = /class\s+(\w+)/i;
      const pyDefRe = /def\s+(\w+)/i;

      const vbClassRe = /(?:Class|Interface|Structure|Module)\s+(\w+)/i;
      const vbMethodRe = /(?:Sub|Function)\s+(\w+)/i;

      const sqlTableRe = /CREATE\s+(?:TABLE|VIEW)\s+(?:[\w"`]+\.)?([\w"`]+)/i;
      const sqlFuncRe = /CREATE\s+(?:FUNCTION|PROCEDURE)\s+(?:[\w"`]+\.)?([\w"`]+)/i;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        if (isJsTsCs) {
          const classMatch = jstscsClassRe.exec(line);
          if (classMatch) {
            currentClassOrTable = classMatch[1]!;
            currentMethod = 'None';
          }
          const methodMatch = jstscsMethodRe.exec(line);
          if (methodMatch) currentMethod = methodMatch[1]!;
          if (/^\s*\}/.test(line)) {
            currentMethod = 'None';
          }
        } else if (isPython) {
          const classMatch = pyClassRe.exec(line);
          if (classMatch) {
            currentClassOrTable = classMatch[1]!;
            currentMethod = 'None';
          }
          const defMatch = pyDefRe.exec(line);
          if (defMatch) currentMethod = defMatch[1]!;
        } else if (isVb) {
          const classMatch = vbClassRe.exec(line);
          if (classMatch) {
            currentClassOrTable = classMatch[1]!;
            currentMethod = 'None';
          }
          const methodMatch = vbMethodRe.exec(line);
          if (methodMatch) currentMethod = methodMatch[1]!;

          if (/^\s*End\s+(Class|Interface|Structure|Module)/i.test(line)) {
            currentClassOrTable = 'None';
          }
          if (/^\s*End\s+(Sub|Function)/i.test(line)) {
            currentMethod = 'None';
          }
        } else if (isSql) {
          const tableMatch = sqlTableRe.exec(line);
          if (tableMatch) {
            currentClassOrTable = tableMatch[1].replace(/['"`]/g, '');
            currentMethod = 'None';
          }
          const funcMatch = sqlFuncRe.exec(line);
          if (funcMatch) {
            currentMethod = funcMatch[1].replace(/['"`]/g, '');
            currentClassOrTable = 'None';
          }
        }

        if (symbolWordRe.test(line)) {
          if (declRe.test(line)) {
            continue;
          }

          refs.push({
            file: relPath,
            class_or_table: currentClassOrTable,
            method: currentMethod,
            line_number: lineNum,
            line_of_code: line.trim(),
          });
        }
      }
    } catch {
      // Ignore unreadable files
    }
  }

  return refs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Definitions
// ═══════════════════════════════════════════════════════════════════════════════

interface ToolDef extends McpToolDefinition {
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

const TOOLS: ToolDef[] = [
  // ── find_indexed_symbol_references ─────────────────────────────────────────
  {
    name: 'find_indexed_symbol_references',
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
        repository: {
          type: 'string',
          description: 'Repository or codebase name to filter nodes',
        },
        scope: {
          type: 'string',
          enum: ['file', 'module', 'project'],
          description: 'Search scope — controls BFS depth (file=1, module=2, project=3)',
          default: 'project',
        },
      },
      required: ['query', 'repository'],
    },
    handler: async (args) => {
      const query = String(args.query ?? '');
      const filePath = args.file_path ? String(args.file_path) : undefined;
      const repository = args.repository ? String(args.repository) : undefined;
      const scope = (args.scope as QueryScope) ?? 'project';

      const context = getRepoContext(filePath);
      const { graph, indexedFiles } = context;
      graph.query({ query, filePath, scope, repository });

      const root = context.currentProjectRoot || lastActiveRoot;

      const definitions = graph.findDefinitions(query, filePath, repository).map((node) => {
        let lineOfCode = `[Definition] ${node.type} ${node.label}`;
        const lineNumber = (node.metadata?.line as number) ?? 1;
        const fullPath = path.isAbsolute(node.filePath) ? node.filePath : path.join(root, node.filePath);
        try {
          if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split(/\r?\n/);
            const lineIndex = lineNumber - 1;
            if (lines[lineIndex] !== undefined) {
              lineOfCode = lines[lineIndex].trim();
            }
          }
        } catch {}

        return {
          file: node.filePath,
          repository: node.repository,
          class_or_table: 'None',
          method: 'None',
          line_number: lineNumber,
          line_of_code: lineOfCode,
          is_definition: true,
          symbol_type: node.type,
        };
      });

      let targetFiles = new Set<string>();
      if (repository) {
        const repoNodes = graph.getAllNodes().filter(n => n.repository === repository && n.type === 'file');
        for (const n of repoNodes) {
          targetFiles.add(n.filePath);
        }
      } else {
        targetFiles = indexedFiles;
      }

      if (filePath) {
        const absTarget = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(root, filePath);

        targetFiles = new Set(
          Array.from(targetFiles).filter((f) => {
            const absF = path.isAbsolute(f) ? f : path.resolve(root, f);
            try {
              const stat = fs.statSync(absTarget);
              if (stat.isDirectory()) {
                return absF.startsWith(absTarget + path.sep) || absF === absTarget;
              } else {
                return absF === absTarget;
              }
            } catch {
              return absF === absTarget;
            }
          })
        );
      }

      const usages = findCodeReferences(query, root, targetFiles).map((ref) => ({
        ...ref,
        repository,
        is_definition: false,
        symbol_type: 'reference',
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify([...definitions, ...usages], null, 2),
          },
        ],
      };
    },
  },

  // ── repograph_index_file ──────────────────────────────────────────────────
  {
    name: 'repograph_index_file',
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
        repository: {
          type: 'string',
          description: 'Repository or codebase name to segment these nodes',
        },
      },
      required: ['file_path', 'repository'],
    },
    handler: async (args) => {
      const filePath = String(args.file_path ?? '');
      const content = args.content ? String(args.content) : undefined;
      const repositoryArg = args.repository ? String(args.repository) : undefined;

      const context = getRepoContext(filePath);
      const { graph, indexedFiles, fileHashes, store } = context;

      const repository = repositoryArg ?? (path.basename(context.currentProjectRoot || path.dirname(filePath)) || 'default');
      const repoIndexer = new FileIndexer(store, repository);

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

      const indexed = repoIndexer.indexFile(filePath, fileContent, repository);
      const added = repoIndexer.applyToGraph(graph, indexed);
      indexedFiles.add(filePath);

      // Persist to store
      const hash = FileIndexer.computeHash(fileContent);
      fileHashes.set(filePath, hash);
      store.recordIndexedFile(filePath, hash, indexed.nodes.length, repository);
      for (const node of indexed.nodes) {
        try { store.insertNode(node); } catch { /* duplicate */ }
      }
      for (const edge of indexed.edges) {
        try { store.insertEdge(edge); } catch { /* duplicate */ }
      }
      saveGraphState(context);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'indexed',
                file: filePath,
                repository,
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

  // ── repograph_index_project ───────────────────────────────────────────────
  {
    name: 'repograph_index_project',
    description: 'Index an entire project directory into the knowledge graph. Scans .ts, .tsx, .js, .jsx, .mjs, .cjs files.',
    inputSchema: {
      type: 'object',
      properties: {
        dir_path: {
          type: 'string',
          description: 'Root directory path of the project to index',
        },
        repository: {
          type: 'string',
          description: 'Repository or codebase name to segment these nodes',
        },
      },
      required: ['dir_path', 'repository'],
    },
    handler: async (args) => {
      const dirPath = String(args.dir_path ?? '');
      const repositoryArg = args.repository ? String(args.repository) : undefined;

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

      const context = getRepoContext(dirPath);
      const { graph, indexedFiles } = context;

      const repository = repositoryArg ?? path.basename(path.resolve(dirPath)) ?? 'default';
      const repoIndexer = new FileIndexer(context.store, repository);

      const project = repoIndexer.indexDirectory(dirPath, undefined, repository);
      const stats = repoIndexer.applyProjectToGraph(graph, project);
      context.currentProjectRoot = dirPath;

      // Track all indexed files and persist to store
      const { store } = context;
      for (const f of project.files) {
        indexedFiles.add(f.filePath);
        try {
          const fullPath = path.join(dirPath, f.filePath);
          const content = fs.readFileSync(fullPath, 'utf-8');
          const hash = computeFileHash(content);
          store.recordIndexedFile(f.filePath, hash, f.nodes.length, repository);
          for (const node of f.nodes) {
            try { store.insertNode(node); } catch { /* duplicate */ }
          }
          for (const edge of f.edges) {
            try { store.insertEdge(edge); } catch { /* duplicate */ }
          }
        } catch { /* ignore read/insert errors */ }
      }

      saveGraphState(context);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'indexed',
                root: project.rootDir,
                repository,
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

  // ── repograph_find_references ─────────────────────────────────────────────
  {
    name: 'repograph_find_references',
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
        repository: {
          type: 'string',
          description: 'Repository or codebase name to filter nodes',
        },
      },
      required: ['symbol', 'repository'],
    },
    handler: async (args) => {
      const symbol = String(args.symbol ?? '');
      const projectPath = args.project_path ? String(args.project_path) : undefined;
      const repository = args.repository ? String(args.repository) : undefined;

      const context = getRepoContext(projectPath);
      const { graph, indexedFiles } = context;
      const results = graph.findReferences(symbol, projectPath, repository);

      const root = context.currentProjectRoot || lastActiveRoot;
      let targetFiles = indexedFiles;
      if (repository) {
        targetFiles = new Set(
          graph.getAllNodes()
            .filter(n => n.repository === repository && n.type === 'file')
            .map(n => n.filePath)
        );
      }
      const codeReferences = findCodeReferences(symbol, root, targetFiles).map(ref => ({ ...ref, repository }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(codeReferences, null, 2),
          },
        ],
      };
    },
  },

  // ── repograph_find_definitions ────────────────────────────────────────────
  {
    name: 'repograph_find_definitions',
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
        repository: {
          type: 'string',
          description: 'Repository or codebase name to filter nodes',
        },
      },
      required: ['symbol', 'repository'],
    },
    handler: async (args) => {
      const symbol = String(args.symbol ?? '');
      const filePath = args.file_path ? String(args.file_path) : undefined;
      const repository = args.repository ? String(args.repository) : undefined;

      const { graph } = getRepoContext(filePath);
      const definitions = graph.findDefinitions(symbol, filePath, repository);

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
                  repository: d.repository,
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
  getRepoContext();

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
