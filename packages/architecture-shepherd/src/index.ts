#!/usr/bin/env node

/**
 * ArchitectureShepherd MCP Server
 *
 * Parses ARCHITECTURE.md manifests, validates code paths against layer boundaries,
 * and checks git diffs for architecture violations.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';

import { createLogger } from '@hermes/shared';
import { parseManifest, loadManifestFromFile } from './manifest-parser.js';
import type { Manifest } from './manifest-parser.js';
import { checkFiles } from './layer-checker.js';
import { checkDiff } from './diff-checker.js';

// ── Logger ──────────────────────────────────────────────────────────────────

const log = createLogger('architecture-shepherd');

// ── In-memory manifest store ────────────────────────────────────────────────

const manifestStore = new Map<string, Manifest>();

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'architecture_shepherd.load_manifest',
    description:
      'Load and parse an ARCHITECTURE.md manifest from a file path or raw content. Returns a manifest ID for use with other tools.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to ARCHITECTURE.md file (optional if content is provided)',
        },
        content: {
          type: 'string',
          description: 'Raw manifest content as string (alternative to path)',
        },
      },
    },
  },
  {
    name: 'architecture_shepherd.check',
    description:
      'Check file paths against an architecture manifest for layer boundary violations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of file paths to check',
        },
        manifest_id: {
          type: 'string',
          description: 'Manifest ID returned by load_manifest',
        },
      },
      required: ['paths', 'manifest_id'],
    },
  },
  {
    name: 'architecture_shepherd.check_diff',
    description:
      'Check a git diff against an architecture manifest for introduced layer boundary violations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        diff: {
          type: 'string',
          description: 'Git diff output to analyze',
        },
        manifest_id: {
          type: 'string',
          description: 'Manifest ID returned by load_manifest',
        },
      },
      required: ['diff', 'manifest_id'],
    },
  },
];

// ── Tool handlers ───────────────────────────────────────────────────────────

async function handleLoadManifest(args: Record<string, unknown>) {
  const path = args.path as string | undefined;
  const content = args.content as string | undefined;

  if (!path && !content) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            status: 'error',
            message: 'Either "path" or "content" must be provided',
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    let manifest: Manifest;

    if (content) {
      manifest = parseManifest(content);
    } else {
      manifest = loadManifestFromFile(path!);
    }

    const manifestId = randomUUID();
    manifestStore.set(manifestId, manifest);

    log.info('Manifest loaded', {
      manifestId,
      name: manifest.name,
      layers: manifest.layers.length,
      components: manifest.components.length,
      boundaries: manifest.boundaries.length,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              status: 'ok',
              manifest_id: manifestId,
              summary: {
                name: manifest.name,
                layers: manifest.layers.map((l) => ({
                  name: l.name,
                  dependsOn: l.dependsOn,
                })),
                components: manifest.components.map((c) => ({
                  path: c.path,
                  layer: c.layer,
                })),
                boundaries: manifest.boundaries.map((b) => b.description),
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Failed to load manifest', { error: message });
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ status: 'error', message }),
        },
      ],
      isError: true,
    };
  }
}

async function handleCheck(args: Record<string, unknown>) {
  const paths = args.paths as string[];
  const manifestId = args.manifest_id as string;

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            status: 'error',
            message: '"paths" must be a non-empty array of file paths',
          }),
        },
      ],
      isError: true,
    };
  }

  const manifest = manifestStore.get(manifestId);
  if (!manifest) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            status: 'error',
            message: `Manifest with ID "${manifestId}" not found. Call load_manifest first.`,
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    const result = checkFiles(paths, manifest);

    log.info('Layer check completed', {
      checkedFiles: result.checkedFiles,
      violations: result.violations.length,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              status: 'ok',
              passed: result.violations.length === 0,
              files_checked: result.checkedFiles,
              violations_count: result.violations.length,
              violations: result.violations.map((v) => ({
                file: v.file,
                line: v.line,
                from_layer: v.fromLayer,
                to_layer: v.toLayer,
                import_path: v.importPath,
                reason: v.reason,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Layer check failed', { error: message });
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ status: 'error', message }),
        },
      ],
      isError: true,
    };
  }
}

async function handleCheckDiff(args: Record<string, unknown>) {
  const diff = args.diff as string;
  const manifestId = args.manifest_id as string;

  if (!diff) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            status: 'error',
            message: '"diff" must be a non-empty string',
          }),
        },
      ],
      isError: true,
    };
  }

  const manifest = manifestStore.get(manifestId);
  if (!manifest) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            status: 'error',
            message: `Manifest with ID "${manifestId}" not found. Call load_manifest first.`,
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    const result = checkDiff(diff, manifest);

    log.info('Diff check completed', {
      filesChanged: result.filesChanged,
      linesAdded: result.linesAdded,
      violations: result.violations.length,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              status: 'ok',
              passed: result.violations.length === 0,
              files_changed: result.filesChanged,
              lines_added: result.linesAdded,
              violations_count: result.violations.length,
              violations: result.violations.map((v) => ({
                file: v.file,
                line: v.line,
                from_layer: v.fromLayer,
                to_layer: v.toLayer,
                import_path: v.importPath,
                reason: v.reason,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Diff check failed', { error: message });
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ status: 'error', message }),
        },
      ],
      isError: true,
    };
  }
}

// ── Server setup ────────────────────────────────────────────────────────────

const SERVER_INFO = {
  name: 'hermes-architecture-shepherd',
  version: '0.1.0',
};

function createServer(): Server {
  const server = new Server(SERVER_INFO, {
    capabilities: {
      tools: {},
    },
  });

  // tools/list
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  // tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
    const { name, arguments: args } = request.params;

    log.info('Tool call received', { tool: name });

    try {
      switch (name) {
        case 'architecture_shepherd.load_manifest':
          return await handleLoadManifest(args ?? {});
        case 'architecture_shepherd.check':
          return await handleCheck(args ?? {});
        case 'architecture_shepherd.check_diff':
          return await handleCheckDiff(args ?? {});
        default:
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  status: 'error',
                  message: `Unknown tool: ${name}`,
                }),
              },
            ],
            isError: true,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Tool handler error', { tool: name, error: message });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ status: 'error', message }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log.info('Starting ArchitectureShepherd MCP server with stdio transport');

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info('ArchitectureShepherd MCP server ready');
  log.info('Registered 3 tools: load_manifest, check, check_diff');
}

main().catch((err) => {
  log.error('Fatal error', { err });
  process.exit(1);
});
