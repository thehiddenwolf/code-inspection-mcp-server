#!/usr/bin/env node

/**
 * @hermes/cli — Unified CLI entry point for Hermes MCP Toolset.
 *
 * Provides:
 *   - MCP server management (start, start:gateway, start:ts, etc.)
 *   - Direct tool execution (run <tool>)
 *   - Tool listing (list)
 *   - Code analysis commands (scan, analyze, audit, decomposer, di-template)
 */

import { Command } from 'commander';
import { createServer, TOOLS, executeTool } from '@hermes/mcp-gateway';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { scanCommand } from './commands/scan.js';
import { analyzeCommand } from './commands/analyze.js';
import { auditCommand } from './commands/audit.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Program Setup
// ═══════════════════════════════════════════════════════════════════════════════

const program = new Command();

program
  .name('hermes-mcp')
  .description('Hermes MCP Toolset — CLI')
  .version('0.1.0');

// ═══════════════════════════════════════════════════════════════════════════════
// Global Options
// ═══════════════════════════════════════════════════════════════════════════════

program
  .option('--transport <type>', 'Transport type: stdio (default) or sse', 'stdio')
  .option('--port <number>', 'Port for SSE transport', '3000')
  .option('--config <path>', 'Path to config file');

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Server Commands
// ═══════════════════════════════════════════════════════════════════════════════

// ── start ──────────────────────────────────────────────────────────────────
program
  .command('start')
  .description('Start the combined MCP gateway server (all tools registered)')
  .option('--transport <type>', 'Transport type: stdio or sse', 'stdio')
  .option('--port <number>', 'Port for SSE transport', '3000')
  .action(async (options: { transport: string; port: string }) => {
    await startGateway(options.transport, parseInt(options.port, 10));
  });

// ── start:gateway ──────────────────────────────────────────────────────────
program
  .command('start:gateway')
  .description('Start the combined MCP gateway server')
  .option('--transport <type>', 'Transport type: stdio or sse', 'stdio')
  .option('--port <number>', 'Port for SSE transport', '3000')
  .action(async (options: { transport: string; port: string }) => {
    await startGateway(options.transport, parseInt(options.port, 10));
  });

// ── start:ts (TokenSqueezer) ──────────────────────────────────────────────
program
  .command('start:ts')
  .description('Start only the TokenSqueezer MCP server')
  .option('--transport <type>', 'Transport type: stdio or sse', 'stdio')
  .option('--port <number>', 'Port for SSE transport', '3000')
  .action(async (options: { transport: string; port: string }) => {
    await startFilteredServer('token_squeezer', options.transport, parseInt(options.port, 10));
  });

// ── start:arch (ArchitectureShepherd) ──────────────────────────────────────
program
  .command('start:arch')
  .description('Start only the ArchitectureShepherd MCP server')
  .option('--transport <type>', 'Transport type: stdio or sse', 'stdio')
  .option('--port <number>', 'Port for SSE transport', '3000')
  .action(async (options: { transport: string; port: string }) => {
    await startFilteredServer('architecture_shepherd', options.transport, parseInt(options.port, 10));
  });

// ── start:rg (RepoGraph) ──────────────────────────────────────────────────
program
  .command('start:rg')
  .description('Start only the RepoGraph MCP server')
  .option('--transport <type>', 'Transport type: stdio or sse', 'stdio')
  .option('--port <number>', 'Port for SSE transport', '3000')
  .action(async (options: { transport: string; port: string }) => {
    await startFilteredServer('repograph', options.transport, parseInt(options.port, 10));
  });

// ── start:pm (PatternMiner) ───────────────────────────────────────────────
program
  .command('start:pm')
  .description('Start only the PatternMiner MCP server')
  .option('--transport <type>', 'Transport type: stdio or sse', 'stdio')
  .option('--port <number>', 'Port for SSE transport', '3000')
  .action(async (options: { transport: string; port: string }) => {
    await startFilteredServer('pattern_miner', options.transport, parseInt(options.port, 10));
  });

// ── start:se (SOLIDEnforcer) ──────────────────────────────────────────────
program
  .command('start:se')
  .description('Start only the SOLIDEnforcer MCP server')
  .option('--transport <type>', 'Transport type: stdio or sse', 'stdio')
  .option('--port <number>', 'Port for SSE transport', '3000')
  .action(async (options: { transport: string; port: string }) => {
    await startFilteredServer('solid_enforcer', options.transport, parseInt(options.port, 10));
  });

// ── start:tr (TaskRouter) ─────────────────────────────────────────────────
program
  .command('start:tr')
  .description('Start only the TaskRouter MCP server')
  .option('--transport <type>', 'Transport type: stdio or sse', 'stdio')
  .option('--port <number>', 'Port for SSE transport', '3000')
  .action(async (options: { transport: string; port: string }) => {
    await startFilteredServer('task_router', options.transport, parseInt(options.port, 10));
  });

// ── run ────────────────────────────────────────────────────────────────────
program
  .command('run')
  .description('Run a single MCP tool and output the result to stdout')
  .argument('<tool>', 'Tool name (e.g. token_squeezer.squeeze)')
  .argument('[args]', 'JSON string of tool arguments')
  .action(async (tool: string, argsJson: string | undefined) => {
    await runTool(tool, argsJson);
  });

// ── list ───────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all available MCP tools with their schemas')
  .action(async () => {
    const toolsInfo = TOOLS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
    process.stdout.write(JSON.stringify(toolsInfo, null, 2) + '\n');
  });

// ═══════════════════════════════════════════════════════════════════════════════
// Code Analysis Commands (from Phase 1-5)
// ═══════════════════════════════════════════════════════════════════════════════

// ── scan ──────────────────────────────────────────────────────────────────
program
  .command('scan')
  .description('Run a pattern-miner scan on source paths')
  .argument('[paths...]', 'Source files or directories to scan')
  .option('--format <format>', 'Output format (json, pretty, ci)', 'pretty')
  .option('--min-confidence <number>', 'Minimum confidence threshold (0-1)', '0.7')
  .action(async (paths: string[] | undefined, options: { format: string; minConfidence: string }) => {
    await scanCommand(paths ?? ['.'], {
      format: options.format as 'json' | 'pretty' | 'ci',
      minConfidence: parseFloat(options.minConfidence),
    });
  });

// ── analyze ───────────────────────────────────────────────────────────────
program
  .command('analyze')
  .description('Run task-router analysis on a file')
  .argument('<file>', 'Source file to analyze')
  .option('--format <format>', 'Output format (json, pretty, ci)', 'pretty')
  .action(async (file: string, options: { format: string }) => {
    await analyzeCommand(file, {
      format: options.format as 'json' | 'pretty' | 'ci',
    });
  });

// ── audit ─────────────────────────────────────────────────────────────────
program
  .command('audit')
  .description('Run solid-enforcer SOLID audit on a file')
  .argument('<file>', 'Source file to audit')
  .option('--format <format>', 'Output format (json, pretty, ci)', 'pretty')
  .option('--loc-threshold <number>', 'Max lines before SRP warning', '300')
  .option('--max-interface-methods <number>', 'Max interface members before ISP warning', '10')
  .action(async (file: string, options: { format: string; locThreshold: string; maxInterfaceMethods: string }) => {
    await auditCommand(file, {
      format: options.format as 'json' | 'pretty' | 'ci',
      locThreshold: parseInt(options.locThreshold, 10),
      maxInterfaceMethods: parseInt(options.maxInterfaceMethods, 10),
    });
  });

// ── decomposer ────────────────────────────────────────────────────────────
program
  .command('decomposer')
  .description('Run task-router decomposer on a plan file')
  .argument('<plan-file>', 'Plan file to decompose')
  .option('--format <format>', 'Output format (json, pretty, ci)', 'pretty')
  .action(async (planFile: string, options: { format: string }) => {
    const { decomposerCommand } = await import('./commands/analyze.js');
    await decomposerCommand(planFile, {
      format: options.format as 'json' | 'pretty' | 'ci',
    });
  });

// ── di-template ───────────────────────────────────────────────────────────
program
  .command('di-template')
  .description('Generate a DI template for a class')
  .argument('<class-name>', 'Name of the class')
  .option('--interfaces <interfaces>', 'Comma-separated list of dependency interface names')
  .option('--language <language>', 'Target language (typescript, javascript)', 'typescript')
  .option('--format <format>', 'Output format (json, pretty, ci)', 'pretty')
  .action(async (className: string, options: { interfaces?: string; language: string; format: string }) => {
    const { diTemplateCommand } = await import('./commands/audit.js');
    await diTemplateCommand(className, {
      interfaces: options.interfaces?.split(',').map((s) => s.trim()).filter(Boolean) ?? [],
      language: options.language as 'typescript' | 'javascript',
      format: options.format as 'json' | 'pretty' | 'ci',
    });
  });

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Server Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Start the combined MCP gateway with all tools registered.
 */
async function startGateway(transportType: string, port: number): Promise<void> {
  if (transportType === 'sse') {
    console.error('SSE transport requires additional setup. Launching with stdio instead.');
    console.error('For SSE, use: hermes-mcp start:gateway --transport sse --port 3000');
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`Hermes MCP Gateway ready (${TOOLS.length} tools, stdio transport)`);
}

/**
 * Start an MCP server filtered to a single namespace.
 * Uses the same gateway infrastructure but only registers tools
 * matching the given namespace prefix.
 */
async function startFilteredServer(namespace: string, transportType: string, port: number): Promise<void> {
  const filteredTools = TOOLS.filter((t) => t.name.startsWith(namespace));

  if (filteredTools.length === 0) {
    console.error(`No tools found for namespace: ${namespace}`);
    process.exit(1);
  }

  console.error(`Starting filtered MCP server for "${namespace}" (${filteredTools.length} tools)`);

  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const {
    ListToolsRequestSchema,
    CallToolRequestSchema,
  } = await import('@modelcontextprotocol/sdk/types.js');

  const server = new Server(
    { name: `hermes-mcp-${namespace}`, version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: filteredTools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolDef = filteredTools.find((t) => t.name === name);
    if (!toolDef) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              status: 'not_implemented',
              tool: name,
              message: `"${name}" is not yet implemented in the standalone "${namespace}" server.`,
              input_args: args ?? {},
            },
            null,
            2,
          ),
        },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Hermes MCP "${namespace}" server ready (${filteredTools.length} tools)`);
}

/**
 * Run a single MCP tool and output the result to stdout.
 */
async function runTool(toolName: string, argsJson: string | undefined): Promise<void> {
  const toolDef = TOOLS.find((t) => t.name === toolName);
  if (!toolDef) {
    console.error(`Unknown tool: ${toolName}`);
    console.error(`Run 'hermes-mcp list' to see available tools.`);
    process.exit(1);
  }

  let args: Record<string, unknown> = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson) as Record<string, unknown>;
    } catch {
      console.error(`Error: Invalid JSON arguments: "${argsJson}"`);
      process.exit(1);
    }
  }

  try {
    const resultText = await executeTool(toolName, args);
    process.stdout.write(resultText + '\n');
  } catch (err) {
    console.error(`Error running tool ${toolName}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Parse
// ═══════════════════════════════════════════════════════════════════════════════

program.parse(process.argv);
