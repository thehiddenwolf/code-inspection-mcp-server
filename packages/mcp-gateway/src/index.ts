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
import { createLogger, PACKAGE_VERSION, LanguagePackRegistry, loadLanguagePacks, loadConfigAndPacks, type LanguagePack, DEFAULT_PACKS } from '@hermes/shared';
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
import { createGraphStore, computeFileHash } from '@hermes/repograph/graph-store.js';
import { runScan } from '@hermes/pattern-miner/scanner.js';
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
import { trackReference, getInsights, executeRefactorBatch, getCallHierarchy, getDependencyReport } from '@hermes/repograph/insights-refactor.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Logger
// ═══════════════════════════════════════════════════════════════════════════════

const log = createLogger('code-inspection-mcp-gateway');

// ═══════════════════════════════════════════════════════════════════════════════
// Gateway Global State
// ═══════════════════════════════════════════════════════════════════════════════

const manifestStore = new Map<string, Manifest>();
const customPatterns = new Map<string, any>();

// Initialize RepoGraph components with multi-repo support
interface RepoContext {
  store: any;
  graph: GraphEngine;
  indexer: FileIndexer;
  indexedFiles: Set<string>;
  currentProjectRoot?: string;
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

    // Load persisted repograph nodes
    try {
      const nodes = store.getAllNodes();
      const edges = store.getAllEdges();
      for (const n of nodes) {
        graph.addNode(n);
        if (n.type === 'file') {
          indexedFiles.add(n.filePath);
        }
      }
      for (const e of edges) {
        try { graph.addEdge(e); } catch { /* ignore duplicates/stale */ }
      }
      log.info(`Loaded ${nodes.length} nodes and ${edges.length} edges for root: ${root}`);
    } catch (err) {
      log.warn(`Could not load persisted repograph store for ${root}`, { err });
    }

    context = { store, graph, indexer, indexedFiles, currentProjectRoot: root };
    repoContexts.set(root, context);
  }
  return context;
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

// Pre-initialize for process.cwd() to preserve default behavior
getRepoContext();

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Definitions
// ═══════════════════════════════════════════════════════════════════════════════

interface ToolDef extends McpToolDefinition {
  version?: string;
}

export const TOOLS: ToolDef[] = [
  // ── TokenSqueezer ──────────────────────────────────────────────────────────
  {
    name: 'get_symbols',
    description: 'Read high-level symbol declarations (classes, functions, interfaces, imports) or the full file if it is small enough.',
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
            outline: {
              type: 'boolean',
              default: false,
              description: 'Return a clean hierarchical structural outline of the code symbols instead of passive pass placeholders',
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
    name: 'find_indexed_symbol_references',
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
    name: 'index_codebase',
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
                'complexity', 'duplication', 'architecture', 'best_practice',
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
  },
  // ── Insights & Refactoring ──────────────────────────────────────────────────
  {
    name: 'insight_reference_tracker',
    description: 'Track definitions, usages (references), and documentation mappings for a symbol.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name to track (class, function, variable, etc.)' },
        project_path: { type: 'string', description: 'Optional project root path' },
        include_docs: { type: 'boolean', default: true, description: 'Whether to scan markdown documentation for occurrences' }
      },
      required: ['symbol']
    }
  },
  {
    name: 'get_insights',
    description: 'Combine multiple definition, usage, reference, or documentation queries into a single result.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of symbols to track'
        },
        queries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['definitions', 'usages', 'references', 'docs'] },
              symbol: { type: 'string' }
            },
            required: ['type', 'symbol']
          },
          description: 'Optional list of specific queries to execute'
        },
        project_path: { type: 'string', description: 'Optional project root path' },
        include_docs: { type: 'boolean', default: true, description: 'Whether to scan markdown documentation' }
      }
    }
  },
  {
    name: 'refactor_execute_batch',
    description: 'Atomically execute multiple refactoring operations (rename, replace, move, create, delete) as a transaction.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['rename', 'replace', 'move', 'create', 'delete'] },
              filePath: { type: 'string', description: 'Target file path' },
              fromPath: { type: 'string', description: 'Source file path (for move)' },
              toPath: { type: 'string', description: 'Destination file path (for move)' },
              oldName: { type: 'string', description: 'Old name for rename' },
              newName: { type: 'string', description: 'New name for rename' },
              find: { type: 'string', description: 'Text block to find for replace' },
              replace: { type: 'string', description: 'Text block to replace with' },
              content: { type: 'string', description: 'Content for create' }
            },
            required: ['type']
          },
          description: 'Ordered array of refactoring operations to execute sequentially'
        },
        project_path: { type: 'string', description: 'Optional project root path' }
      },
      required: ['operations']
    }
  },
  {
    name: 'get_indexed_symbol_tree',
    description: 'Get call hierarchy tree (incoming and outgoing calls) for a symbol.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Name of the function or method' },
        direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'], default: 'both', description: 'Direction to trace calls' },
        max_depth: { type: 'integer', default: 3, description: 'Maximum recursion depth' },
        project_path: { type: 'string', description: 'Optional project root path' }
      },
      required: ['symbol']
    }
  },
  {
    name: 'repograph_get_dependencies',
    description: 'Analyze codebase imports to list file dependencies and pinpoint circular dependency paths.',
    version: '0.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Optional project root path' }
      }
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
    case 'get_symbols': {
      let code = args?.code ? String(args.code) : '';
      let lang = args?.language ? String(args.language) : '';
      const filePath = args?.filePath ? String(args.filePath) : '';
      const options = (args?.options) ?? {};

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
    case 'find_indexed_symbol_references': {
      const query = String(args?.query ?? '');
      const filePath = args?.file_path ? String(args.file_path) : undefined;
      const scope = (args?.scope) ?? 'project';
      const context = getRepoContext(filePath);
      const { graph, indexedFiles } = context;
      const queryResult = graph.query({ query, filePath, scope });

      const root = context.currentProjectRoot || lastActiveRoot;
      const codeReferences = findCodeReferences(query, root, indexedFiles);

      resultText = JSON.stringify(codeReferences, null, 2);
      break;
    }
    case 'index_codebase': {
      const dirPath = String(args?.path ?? '');
      const context = getRepoContext(dirPath);
      const { graph, indexer, indexedFiles, store } = context;
      const project = indexer.indexDirectory(dirPath);
      const stats = indexer.applyProjectToGraph(graph, project);

      for (const f of project.files) {
        indexedFiles.add(f.filePath);
        try {
          const fullPath = path.join(project.rootDir, f.filePath);
          const content = fs.readFileSync(fullPath, 'utf-8');
          const hash = computeFileHash(content);
          store.recordIndexedFile(f.filePath, hash, f.nodes.length);
          for (const node of f.nodes) {
            try { store.insertNode(node); } catch { /* duplicate */ }
          }
          for (const edge of f.edges) {
            try { store.insertEdge(edge); } catch { /* duplicate */ }
          }
        } catch { /* ignore read/insert errors */ }
      }

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
      const definition = args?.definition;
      customPatterns.set(definition.id, definition);

      const registry = LanguagePackRegistry.getInstance();
      for (const lang of (definition.languages ?? [])) {
        const pack = registry.lookup(lang);
        if (pack) {
          if (!pack.patternMiner) {
            pack.patternMiner = {};
          }
          if (!pack.patternMiner.patterns) {
            pack.patternMiner.patterns = [];
          }
          if (!pack.patternMiner.patterns.some(p => p.id === definition.id)) {
            pack.patternMiner.patterns.push(definition);
          }
        }
      }

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

    case 'insight_reference_tracker': {
      const symbol = String(args?.symbol ?? '');
      const projectPath = args?.project_path ? String(args.project_path) : undefined;
      const includeDocs = args?.include_docs !== false;

      if (!symbol) {
        throw new Error("Parameter 'symbol' is required.");
      }

      const context = getRepoContext(projectPath);
      const root = context.currentProjectRoot || lastActiveRoot;
      const result = trackReference(symbol, root, context.graph, context.indexedFiles, includeDocs, findCodeReferences);
      resultText = JSON.stringify(result, null, 2);
      break;
    }

    case 'get_insights': {
      const symbols = args?.symbols as string[] | undefined;
      const queries = args?.queries as any[] | undefined;
      const projectPath = args?.project_path ? String(args.project_path) : undefined;
      const includeDocs = args?.include_docs !== false;

      const context = getRepoContext(projectPath);
      const root = context.currentProjectRoot || lastActiveRoot;
      const result = getInsights({ symbols, queries, include_docs: includeDocs }, root, context.graph, context.indexedFiles, findCodeReferences);
      resultText = JSON.stringify(result, null, 2);
      break;
    }

    case 'refactor_execute_batch': {
      const operations = args?.operations as any[] ?? [];
      const projectPath = args?.project_path ? String(args.project_path) : undefined;

      if (!operations || !Array.isArray(operations) || operations.length === 0) {
        throw new Error("Parameter 'operations' must be a non-empty array.");
      }

      const context = getRepoContext(projectPath);
      const root = context.currentProjectRoot || lastActiveRoot;
      const result = executeRefactorBatch(operations, root);
      resultText = JSON.stringify(result, null, 2);
      break;
    }

    case 'get_indexed_symbol_tree': {
      const symbol = String(args?.symbol ?? '');
      const direction = (args?.direction as 'incoming' | 'outgoing' | 'both') ?? 'both';
      const maxDepth = Number(args?.max_depth ?? 3);
      const projectPath = args?.project_path ? String(args.project_path) : undefined;

      if (!symbol) {
        throw new Error("Parameter 'symbol' is required.");
      }

      const context = getRepoContext(projectPath);
      const result = getCallHierarchy(symbol, direction, context.graph, maxDepth);
      resultText = JSON.stringify(result, null, 2);
      break;
    }

    case 'repograph_get_dependencies': {
      const projectPath = args?.project_path ? String(args.project_path) : undefined;
      const context = getRepoContext(projectPath);
      const result = getDependencyReport(context.graph);
      resultText = JSON.stringify(result, null, 2);
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

export async function initializeGateway(configPath?: string): Promise<void> {
  const registry = LanguagePackRegistry.getInstance();

  // 0. Register default language packs first
  for (const pack of DEFAULT_PACKS) {
    registry.register(pack);
  }

  // 1. Load dynamic language packs via hermes-config.json (file, npm, git)
  await loadConfigAndPacks(registry, configPath);

  // 2. Load auto-discover packs from folders
  const pathsToLoad = [
    process.env.HERMES_LANGUAGE_PACKS_DIR,
    path.join(os.homedir(), '.code-inspect-mcp', 'language-packs'),
    path.join(process.cwd(), 'config', 'language-packs'),
  ].filter(Boolean) as string[];

  for (const dir of pathsToLoad) {
    if (fs.existsSync(dir)) {
      log.info(`Loading language packs from directory: ${dir}`);
      loadLanguagePacks(registry, dir);
    }
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useSSE = args.includes('--sse');
  const ssePort = parseInt(process.env.PORT ?? '3100', 10);

  // Parse config path if provided via --config
  let configPath: string | undefined;
  const configIndex = args.indexOf('--config');
  if (configIndex !== -1 && args[configIndex + 1]) {
    configPath = args[configIndex + 1];
  }

  await initializeGateway(configPath);

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
