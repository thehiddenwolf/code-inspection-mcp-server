#!/usr/bin/env node

/**
 * Code Inspection MCP Gateway — MCP SDK v2 server that registers and executes all tools.
 *
 * Supported transports: stdio (default), SSE (optional via --sse).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  McpToolDefinition,
  McpToolCallResult,
} from '@hermes/shared';
import { createLogger, PACKAGE_VERSION, LanguagePackRegistry, loadLanguagePacks } from '@hermes/shared';
import * as os from 'node:os';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Specialist Tool Core Imports ───────────────────────────────────────────
import { squeeze } from '@hermes/token-squeezer/squeezer.js';
import { EXTENSION_TO_LANGUAGE } from '@hermes/token-squeezer/types.js';
import { parseManifest, loadManifestFromFile } from '@hermes/architecture-shepherd/manifest-parser.js';
import type { Manifest } from '@hermes/architecture-shepherd/manifest-parser.js';
import { checkFiles } from '@hermes/architecture-shepherd/layer-checker.js';
import { checkDiff } from '@hermes/architecture-shepherd/diff-checker.js';
import { GraphEngine } from '@hermes/repograph/graph-engine.js';
import { FileIndexer } from '@hermes/repograph/file-indexer.js';
import { createGraphStore } from '@hermes/repograph/graph-store.js';
import { runScan, findDeadCode } from '@hermes/pattern-miner/scanner.js';
import { runCloneDetection } from '@hermes/pattern-miner/clone-detection/clone-scanner.js';
import { blueprintSearch } from '@hermes/pattern-miner/blueprint-search/engine.js';
import catalog from '@hermes/pattern-miner/patterns/catalog.js';
import { estimateComplexity, extractSubtasks } from '@hermes/task-router/estimator.js';
import { checkSingleResponsibility } from '@hermes/solid-enforcer/rules/single-responsibility.js';
import { checkOpenClosed } from '@hermes/solid-enforcer/rules/open-closed.js';
import { checkLiskovSubstitution } from '@hermes/solid-enforcer/rules/liskov.js';
import { checkInterfaceSegregation } from '@hermes/solid-enforcer/rules/interface-segregation.js';
import { checkDependencyInversion } from '@hermes/solid-enforcer/rules/dependency-inversion.js';
import { fixFile } from '@hermes/lint-fixer/fixer.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Logger
// ═══════════════════════════════════════════════════════════════════════════════

const log = createLogger('hermes-mcp-gateway');

// ═══════════════════════════════════════════════════════════════════════════════
// Gateway Global State
// ═══════════════════════════════════════════════════════════════════════════════

const manifestStore = new Map<string, Manifest>();
const customPatterns = new Map<string, any>();

// Initialize RepoGraph components
const store = createGraphStore('.code-inpect-mcp/reprograph.db');
const graph = new GraphEngine();
const indexer = new FileIndexer(store);

// Load persisted repograph nodes
try {
  const nodes = store.getAllNodes();
  const edges = store.getAllEdges();
  for (const n of nodes) graph.addNode(n);
  for (const e of edges) {
    try { graph.addEdge(e); } catch { /* ignore duplicates/stale */ }
  }
} catch (err) {
  log.warn('Could not load persisted repograph store', { err });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Definitions
// ═══════════════════════════════════════════════════════════════════════════════

interface ToolDef extends McpToolDefinition {
  version?: string;
}

export const TOOLS: ToolDef[] = [
  // ── TokenSqueezer ──────────────────────────────────────────────────────────
  {
    name: 'token_squeezer_squeeze',
    description: 'Reduce code context via AST manipulation. Returns a structurally-squeezed skeleton.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Source code to squeeze (ignored if filePath is provided)' },
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'python', 'go', 'jsx', 'tsx'],
          description: 'Source language (auto-detected if filePath is provided)',
        },
        filePath: {
          type: 'string',
          description: 'Absolute path to the file to squeeze directly from disk (alternative to passing code)',
        },
        options: {
          type: 'object',
          properties: {
            preserve_comments: { type: 'boolean', default: false },
            preserve_imports: { type: 'boolean', default: true },
            aggressiveness: {
              type: 'string',
              enum: ['conservative', 'balanced', 'aggressive'],
              default: 'balanced',
            },
            max_tokens: { type: 'integer', description: 'Maximum token target' },
            include_private: { type: 'boolean', default: false },
            output_format: {
              type: 'string',
              enum: ['text', 'json', 'both'],
              default: 'both',
            },
          },
        },
      },
      required: [],
    },
  },

  // ── ArchitectureShepherd ───────────────────────────────────────────────────
  {
    name: 'architecture_shepherd_load_manifest',
    description: 'Load and parse an ARCHITECTURE.md manifest from a file path or raw content.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to ARCHITECTURE.md (optional)' },
        content: { type: 'string', description: 'Raw manifest content (alternative to path)' },
      },
    },
  },
  {
    name: 'architecture_shepherd_check',
    description: 'Check file paths against an architecture manifest for layer boundary violations.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to check against the manifest',
        },
        manifest_id: { type: 'string', description: 'Loaded manifest identifier' },
      },
      required: ['paths', 'manifest_id'],
    },
  },
  {
    name: 'architecture_shepherd_check_diff',
    description: 'Check a git diff against an architecture manifest for introduced violations.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'Git diff output to analyze' },
        manifest_id: { type: 'string', description: 'Loaded manifest identifier' },
      },
      required: ['diff', 'manifest_id'],
    },
  },

  // ── RepoGraph ─────────────────────────────────────────────────────────────
  {
    name: 'repograph_query',
    description: 'Query the code knowledge graph for code relationships and structures.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language or structured query' },
        file_path: { type: 'string', description: 'Optional file path to scope the query' },
        scope: {
          type: 'string',
          enum: ['file', 'module', 'project'],
          default: 'project',
          description: 'Query scope',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'repograph_index',
    description: 'Index a codebase into the knowledge graph for querying.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Root path of the codebase to index' },
      },
      required: ['path'],
    },
  },

  // ── PatternMiner ───────────────────────────────────────────────────────────
  {
    name: 'pattern_miner_scan',
    description: 'Scan code paths for known anti-patterns, code smells, and issues.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'File/directory paths to scan',
        },
        patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional pattern filter — only run these pattern IDs',
        },
      },
      required: ['paths'],
    },
  },
  {
    name: 'pattern_miner_find_dead_code',
    description: 'Detect dead code — unused exports, unreachable branches, orphaned functions.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'File/directory paths to analyze',
        },
      },
      required: ['paths'],
    },
  },
  {
    name: 'pattern_miner_get_pattern_catalog',
    description: 'Get the full catalog of built-in and custom patterns.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'pattern_miner_learn_pattern',
    description: 'Register a custom pattern definition for future scans.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        definition: {
          type: 'object',
          description: 'PatternDefinition object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            category: {
              type: 'string',
              enum: [
                'security', 'performance', 'correctness', 'style',
                'complexity', 'duplication', 'dead_code', 'architecture', 'best_practice',
              ],
            },
            severity: {
              type: 'string',
              enum: ['info', 'warning', 'error', 'critical'],
            },
            languages: { type: 'array', items: { type: 'string' } },
            pattern: { type: 'string' },
            message_template: { type: 'string' },
            remediation: { type: 'string' },
          },
          required: ['id', 'name', 'description', 'category', 'languages', 'pattern'],
        },
      },
      required: ['definition'],
    },
  },
  {
    name: 'pattern_miner_find_clones',
    description: 'Find structural clones using Semgrep.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        fragment: { type: 'string', description: 'The code fragment to find clones of' },
        language: {
          type: 'string',
          enum: ['typescript', 'javascript', 'python', 'go', 'java', 'jsx', 'tsx'],
          description: 'Programming language of the fragment',
        },
        searchPath: { type: 'string', description: 'Directory path to search in' },
        minConfidence: { type: 'number', default: 0.6, description: 'Minimum confidence threshold (0-1)' },
        maxResults: { type: 'integer', default: 20, description: 'Maximum number of results to return' },
      },
      required: ['fragment', 'language', 'searchPath'],
    },
  },

  // ── TaskRouter ─────────────────────────────────────────────────────────────
  {
    name: 'task_router_estimate',
    description: 'Estimate the complexity of a task and recommend a model and cost.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        task_description: { type: 'string', description: 'Description of the task to estimate' },
      },
      required: ['task_description'],
    },
  },
  {
    name: 'task_router_decompose',
    description: 'Decompose a task into manageable subtasks with routing recommendations.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        task_description: { type: 'string', description: 'Description of the task to decompose' },
      },
      required: ['task_description'],
    },
  },

  // ── SOLIDEnforcer ──────────────────────────────────────────────────────────
  {
    name: 'solid_enforcer_audit',
    description: 'Run SOLID principle checks on source code and return per-principle results.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Source code to audit' },
        file_path: { type: 'string', description: 'File path for context' },
      },
      required: ['code', 'file_path'],
    },
  },
  {
    name: 'solid_enforcer_generate_di_template',
    description: 'Generate a dependency injection template for a class.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        class_name: { type: 'string', description: 'Name of the class' },
        interfaces: {
          type: 'array',
          items: { type: 'string' },
          description: 'Dependency interface names',
        },
        language: {
          type: 'string',
          enum: ['typescript', 'javascript'],
          default: 'typescript',
          description: 'Target language',
        },
      },
      required: ['class_name', 'interfaces'],
    },
  },
  // ── LintFixer ──────────────────────────────────────────────────────────────
  {
    name: 'lint_fixer_fix',
    description: 'Auto-fix linting and formatting issues for a given file.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the file to lint/fix' },
        dryRun: { type: 'boolean', default: false, description: 'If true, only returns the diff and does not modify the file on disk' }
      },
      required: ['filePath']
    }
  }
];

// Helper for SOLID DI Template Generator
function generateDiTemplate(className: string, interfaces: string[], language: 'typescript' | 'javascript' = 'typescript'): string {
  if (language === 'typescript') {
    const params = interfaces.map(i => `private readonly ${i.charAt(0).toLowerCase() + i.slice(1)}: I${i}`).join(',\n    ');
    return `export class ${className} {\n  constructor(\n    ${params}\n  ) {}\n}`;
  } else {
    const params = interfaces.map(i => i.charAt(0).toLowerCase() + i.slice(1)).join(', ');
    const assigns = interfaces.map(i => {
      const prop = i.charAt(0).toLowerCase() + i.slice(1);
      return `    this.${prop} = ${prop};`;
    }).join('\n');
    return `export class ${className} {\n  constructor(${params}) {\n${assigns}\n  }\n}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Server
// ═══════════════════════════════════════════════════════════════════════════════

const SERVER_INFO = {
  name: 'code-inspection-mcp-gateway',
  version: PACKAGE_VERSION ?? '0.1.0',
};

export async function executeTool(name: string, args: any): Promise<string> {
  let resultText = '';

  switch (name) {
    // ── TokenSqueezer ──
    case 'token_squeezer_squeeze': {
      let code = args?.code ? String(args.code) : '';
      let lang = args?.language ? String(args.language) : '';
      const filePath = args?.filePath ? String(args.filePath) : '';
      const options = (args?.options as any) ?? {};

      if (filePath) {
        if (!fs.existsSync(filePath)) {
          throw new Error(`File does not exist: ${filePath}`);
        }
        code = fs.readFileSync(filePath, 'utf8');
        if (!lang) {
          const ext = path.extname(filePath).toLowerCase();
          lang = EXTENSION_TO_LANGUAGE[ext] || '';
          if (!lang) {
            throw new Error(`Could not auto-detect language for extension "${ext}". Please specify 'language' parameter.`);
          }
        }
      } else {
        if (!code) {
          throw new Error("Either 'code' or 'filePath' parameter must be provided.");
        }
        if (!lang) {
          throw new Error("Parameter 'language' is required when passing 'code' directly.");
        }
      }

      const result = await squeeze(code, lang, options);
      const format = options?.output_format ?? 'text';
      if (format === 'json' || format === 'both') {
        if (format === 'json') {
          resultText = JSON.stringify(result, null, 2);
        } else {
          resultText = `${result.squeezed}\n\n--- Metrics ---\nOriginal Tokens: ${result.original_tokens}\nSqueezed Tokens: ${result.squeezed_tokens}\nReduction: ${(result.reduction_ratio * 100).toFixed(1)}%`;
        }
      } else {
        resultText = result.squeezed;
      }
      break;
    }

    // ── ArchitectureShepherd ──
    case 'architecture_shepherd_load_manifest': {
      const pathVal = args?.path ? String(args.path) : undefined;
      const content = args?.content ? String(args.content) : undefined;
      let manifest: Manifest;
      if (pathVal) {
        manifest = loadManifestFromFile(pathVal);
      } else if (content) {
        manifest = parseManifest(content);
      } else {
        throw new Error('Either path or content must be provided');
      }
      const id = randomUUID();
      manifestStore.set(id, manifest);
      resultText = JSON.stringify({ manifest_id: id, ...manifest }, null, 2);
      break;
    }
    case 'architecture_shepherd_check': {
      const paths = (args?.paths as string[]) ?? [];
      const manifestId = String(args?.manifest_id ?? '');
      const manifest = manifestStore.get(manifestId);
      if (!manifest) throw new Error(`Manifest not found: ${manifestId}`);
      const checkResult = checkFiles(paths, manifest);
      resultText = JSON.stringify({ violations: checkResult.violations, passed: checkResult.violations.length === 0 }, null, 2);
      break;
    }
    case 'architecture_shepherd_check_diff': {
      const diff = String(args?.diff ?? '');
      const manifestId = String(args?.manifest_id ?? '');
      const manifest = manifestStore.get(manifestId);
      if (!manifest) throw new Error(`Manifest not found: ${manifestId}`);
      const checkResult = checkDiff(diff, manifest);
      resultText = JSON.stringify({ violations: checkResult.violations, passed: checkResult.violations.length === 0 }, null, 2);
      break;
    }

    // ── RepoGraph ──
    case 'repograph_query': {
      const query = String(args?.query ?? '');
      const filePath = args?.file_path ? String(args.file_path) : undefined;
      const scope = (args?.scope as any) ?? 'project';
      const queryResult = graph.query({ query, filePath, scope });
      resultText = JSON.stringify({
        matched: queryResult.nodes.length,
        nodes: queryResult.nodes.map((n: any) => ({ id: n.id, type: n.type, label: n.label, file: n.filePath })),
        edges: queryResult.edges.map((e: any) => ({ from: e.from, to: e.to, type: e.type })),
      }, null, 2);
      break;
    }
    case 'repograph_index': {
      const dirPath = String(args?.path ?? '');
      const project = indexer.indexDirectory(dirPath);
      const stats = indexer.applyProjectToGraph(graph, project);
      resultText = JSON.stringify({
        status: 'indexed',
        root: project.rootDir,
        files_indexed: project.files.length,
        total_symbols: project.totalSymbols,
        nodes_added: stats.nodesAdded,
        edges_added: stats.edgesAdded,
      }, null, 2);
      break;
    }

    // ── PatternMiner ──
    case 'pattern_miner_scan': {
      const paths = (args?.paths as string[]) ?? [];
      const patternFilter = args?.patterns as string[] | undefined;
      const scanReport = await runScan({
        directory: paths[0],
        filter: patternFilter ? { patternIds: patternFilter } : undefined
      });
      resultText = JSON.stringify(scanReport, null, 2);
      break;
    }
    case 'pattern_miner_find_dead_code': {
      const paths = (args?.paths as string[]) ?? [];
      const deadCodeReport = await findDeadCode({ directory: paths[0] });
      resultText = JSON.stringify(deadCodeReport, null, 2);
      break;
    }
    case 'pattern_miner_find_clones': {
      const fragment = String(args?.fragment ?? '');
      const language = String(args?.language ?? '');
      const searchPath = String(args?.searchPath ?? '');
      const minConfidence = Number(args?.minConfidence ?? 0.6);
      const maxResults = Number(args?.maxResults ?? 20);
      const clones = await runCloneDetection({
        fragment,
        language: language as any,
        searchPath,
        minConfidence,
        maxResults
      });
      resultText = JSON.stringify(clones, null, 2);
      break;
    }
    case 'pattern_miner_get_pattern_catalog': {
      resultText = JSON.stringify(catalog, null, 2);
      break;
    }
    case 'pattern_miner_learn_pattern': {
      const definition = args?.definition as any;
      customPatterns.set(definition.id, definition);
      resultText = JSON.stringify({ status: 'learned', pattern_id: definition.id }, null, 2);
      break;
    }

    // ── TaskRouter ──
    case 'task_router_estimate': {
      const desc = String(args?.task_description ?? '');
      const est = estimateComplexity(desc);
      resultText = JSON.stringify(est, null, 2);
      break;
    }
    case 'task_router_decompose': {
      const desc = String(args?.task_description ?? '');
      const subtasks = extractSubtasks(desc);
      resultText = JSON.stringify({
        summary: `Decomposed from task description`,
        subtaskCount: subtasks.length,
        subtasks: subtasks.map((title: string, i: number) => ({ id: `sub_${i}`, title, complexity: 1, tier: 1, tierLabel: 'Junior' }))
      }, null, 2);
      break;
    }

    // ── SOLIDEnforcer ──
    case 'solid_enforcer_audit': {
      const code = String(args?.code ?? '');
      const filePath = String(args?.file_path ?? '');
      const violations: any[] = [];
      violations.push(...checkSingleResponsibility(code, filePath));
      violations.push(...checkOpenClosed(code, filePath));
      violations.push(...checkLiskovSubstitution(code, filePath));
      violations.push(...checkInterfaceSegregation(code, filePath));
      violations.push(...checkDependencyInversion(code, filePath));
      resultText = JSON.stringify({
        file: filePath,
        passed: violations.length === 0,
        violations
      }, null, 2);
      break;
    }
    case 'solid_enforcer_generate_di_template': {
      const className = String(args?.class_name ?? '');
      const interfaces = (args?.interfaces as string[]) ?? [];
      const language = (args?.language as 'typescript' | 'javascript') ?? 'typescript';
      resultText = generateDiTemplate(className, interfaces, language);
      break;
    }

    // ── LintFixer ──
    case 'lint_fixer_fix': {
      const filePath = String(args?.filePath ?? '');
      const dryRun = Boolean(args?.dryRun ?? false);
      if (!filePath) {
        throw new Error("Parameter 'filePath' is required.");
      }
      const fixResult = await fixFile(filePath, dryRun);
      resultText = JSON.stringify(fixResult, null, 2);
      break;
    }

    default:
      throw new Error(`Unhandled tool: ${name}`);
  }

  return resultText;
}

export function createServer(): Server {
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
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    log.info('Tool call received', { tool: name });

    const toolDef = TOOLS.find((t) => t.name === name);
    if (!toolDef) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      } satisfies McpToolCallResult;
    }

    try {
      const resultText = await executeTool(name, args);
      return {
        content: [{ type: 'text' as const, text: resultText }],
      };
    } catch (err) {
      log.error('Tool call handler execution failed', { tool: name, err });
      return {
        content: [{ type: 'text' as const, text: `Tool execution error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      } satisfies McpToolCallResult;
    }
  });

  return server;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Start
// ═══════════════════════════════════════════════════════════════════════════════

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useSSE = args.includes('--sse');
  const ssePort = parseInt(process.env.PORT ?? '3100', 10);

  // Auto-discover and load language packs dynamically
  const registry = LanguagePackRegistry.getInstance();
  const pathsToLoad = [
    process.env.HERMES_LANGUAGE_PACKS_DIR,
    path.join(os.homedir(), '.hermes', 'language-packs'),
    path.join(process.cwd(), 'config', 'language-packs'),
  ].filter(Boolean) as string[];

  for (const dir of pathsToLoad) {
    if (fs.existsSync(dir)) {
      log.info(`Loading language packs from directory: ${dir}`);
      loadLanguagePacks(registry, dir);
    }
  }

  const server = createServer();

  if (useSSE) {
    log.info('Starting MCP gateway with SSE transport', { port: ssePort });
    throw new Error('SSE transport not yet implemented. Use stdio transport.');
  }

  // stdio transport (default)
  log.info('Starting MCP gateway with stdio transport');
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info('Code Inspection MCP Gateway ready');
  log.info(`Registered ${TOOLS.length} tools`, { toolCount: TOOLS.length });
  for (const t of TOOLS) {
    log.debug(`  ${t.name}`, { tool: t.name });
  }
}

// Only run main() when this module is the entry point, not when imported
const isMainModule =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('/mcp-gateway/dist/index.js'));

if (isMainModule) {
  main().catch((err) => {
    log.error('Fatal error', { err });
    process.exit(1);
  });
}
