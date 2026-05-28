#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runScan, findDeadCode } from './scanner.js';
import catalog, { getPatternById } from './patterns/catalog.js';
import { generateMarkdownReport, generateJsonReport } from './reporter.js';
import type { PatternFilter } from './types.js';
import type { PatternCategoryType, PatternSeverityType, PatternDefinitionType } from '@hermes/shared/schemas/patterns.js';

import { runCloneDetection, cloneMatchesToFindings } from './clone-detection/clone-scanner.js';
import type { CloneLanguage } from './clone-detection/types.js';
import { blueprintSearch } from './blueprint-search/engine.js';
import type { BlueprintSearchInput } from './blueprint-search/types.js';

/**
 * @hermes/pattern-miner MCP Server
 *
 * Provides six tools:
 *   pattern_miner.scan              — Run a full pattern scan against a directory
 *   pattern_miner.find_dead_code    — Find dead code specifically
 *   pattern_miner.find_clones       — Find structural clones using Semgrep
 *   pattern_miner.blueprint_search  — Unified search using Semgrep + PMD CPD, merged & deduplicated
 *   pattern_miner.get_pattern_catalog  — List all built-in pattern definitions
 *   pattern_miner.learn_pattern     — Register a custom pattern for future scans
 */

const server = new McpServer({
  name: '@hermes/pattern-miner',
  version: '0.1.0',
});

// ── In-memory custom pattern store ──────────────────────
const customPatterns: Map<string, PatternDefinitionType> = new Map();

// ── Tool: pattern_miner.scan ────────────────────────────
server.registerTool(
  'pattern_miner.scan',
  {
    description: 'Run pattern analysis against a directory. Supports filtering by severity, category, language, and specific patterns.',
    inputSchema: {
      directory: z.string().describe('Directory path to scan'),
      extensions: z.array(z.string()).optional().describe('File extensions to include (e.g., [".ts", ".js"])'),
      exclude: z.array(z.string()).optional().describe('Directories to exclude (e.g., ["node_modules", "dist"])'),
      filter: z.object({
        categories: z.array(z.string()).optional().describe('Filter by pattern categories'),
        severities: z.array(z.string()).optional().describe('Filter by severity levels'),
        languages: z.array(z.string()).optional().describe('Filter by programming language'),
        patternIds: z.array(z.string()).optional().describe('Filter by specific pattern IDs'),
      }).optional().describe('Optional filter to narrow the scan'),
      outputFormat: z.enum(['json', 'markdown']).optional().default('json').describe('Output format'),
    },
  },
  async (args) => {
    try {
      const filter: PatternFilter | undefined = args.filter ? {
        categories: args.filter.categories as PatternCategoryType[],
        severities: args.filter.severities as PatternSeverityType[],
        languages: args.filter.languages,
        patternIds: args.filter.patternIds,
      } : undefined;

      const report = await runScan({
        directory: args.directory,
        extensions: args.extensions,
        exclude: args.exclude,
        filter,
      });

      const output = args.outputFormat === 'markdown'
        ? generateMarkdownReport(report)
        : generateJsonReport(report);

      return {
        content: [{ type: 'text', text: output }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error running scan: ${message}` }],
        isError: true,
      };
    }
  },
);

// ── Tool: pattern_miner.find_dead_code ──────────────────
server.registerTool(
  'pattern_miner.find_dead_code',
  {
    description: 'Find dead code (unused exports, unreachable branches, orphaned functions) in a directory.',
    inputSchema: {
      directory: z.string().describe('Directory path to scan for dead code'),
      extensions: z.array(z.string()).optional().describe('File extensions to include'),
      exclude: z.array(z.string()).optional().describe('Directories to exclude'),
      confidence: z.number().min(0).max(1).optional().describe('Minimum confidence threshold (0-1)'),
    },
  },
  async (args) => {
    try {
      const matches = await findDeadCode({
        directory: args.directory,
        extensions: args.extensions,
        exclude: args.exclude,
        confidence: args.confidence,
      });

      const deadCodeResults = matches.map(m => ({
        symbol: m.pattern_name,
        kind: 'function' as const,
        file_path: m.file_path || '',
        line: m.line,
        reason: m.message,
        confidence: args.confidence ?? 0.7,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify(deadCodeResults, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error finding dead code: ${message}` }],
        isError: true,
      };
    }
  },
);

// ── Tool: pattern_miner.find_clones ──────────────────────
server.registerTool(
  'pattern_miner.find_clones',
  {
    description: 'Find structural clones of a code fragment in a codebase using Semgrep pattern matching. Converts the fragment to a structural pattern and searches for structurally similar code.',
    inputSchema: {
      fragment: z.string().describe('The code fragment to find clones of'),
      language: z.enum(['typescript', 'javascript', 'python', 'go', 'java', 'jsx', 'tsx']).describe('Programming language of the fragment'),
      searchPath: z.string().describe('Directory path to search in'),
      minConfidence: z.number().min(0).max(1).optional().default(0.6).describe('Minimum confidence threshold (0-1)'),
      maxResults: z.number().int().positive().optional().default(20).describe('Maximum number of results to return'),
      extensions: z.array(z.string()).optional().describe('File extensions to include'),
    },
  },
  async (args) => {
    try {
      const result = await runCloneDetection({
        fragment: args.fragment,
        language: args.language as CloneLanguage,
        searchPath: args.searchPath,
        minConfidence: args.minConfidence ?? 0.6,
        maxResults: args.maxResults ?? 20,
        extensions: args.extensions,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error finding clones: ${message}` }],
        isError: true,
      };
    }
  },
);

// ── Tool: pattern_miner.blueprint_search ────────────────
server.registerTool(
  'pattern_miner.blueprint_search',
  {
    description: 'Unified blueprint search using Semgrep structural matching AND PMD CPD tokenized clone detection. If a fragment+language is provided, runs Semgrep structural search. Always runs CPD across the directory. Results are merged and deduplicated by (filePath, line range).',
    inputSchema: {
      searchPath: z.string().describe('Directory path to search in'),
      fragment: z.string().optional().describe('Code fragment for Semgrep structural search'),
      language: z.enum(['typescript', 'javascript', 'python', 'go', 'java', 'jsx', 'tsx']).optional().describe('Programming language (required if fragment is provided)'),
      minConfidence: z.number().min(0).max(1).optional().default(0.6).describe('Minimum confidence threshold (0-1)'),
      maxResults: z.number().int().positive().optional().default(50).describe('Maximum number of results to return'),
      extensions: z.array(z.string()).optional().describe('File extensions to include'),
      exclude: z.array(z.string()).optional().describe('Directories to exclude'),
      cpdMinimumTileSize: z.number().int().positive().optional().default(30).describe('CPD minimum tile size in tokens'),
    },
  },
  async (args) => {
    try {
      const result = await blueprintSearch({
        searchPath: args.searchPath,
        fragment: args.fragment,
        language: args.language,
        minConfidence: args.minConfidence ?? 0.6,
        maxResults: args.maxResults ?? 50,
        extensions: args.extensions,
        exclude: args.exclude,
        cpdMinimumTileSize: args.cpdMinimumTileSize ?? 30,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error running blueprint search: ${message}` }],
        isError: true,
      };
    }
  },
);

// ── Tool: pattern_miner.get_pattern_catalog ─────────────
server.registerTool(
  'pattern_miner.get_pattern_catalog',
  {
    description: 'Get the full catalog of built-in pattern definitions.',
    inputSchema: {
      category: z.string().optional().describe('Filter by category (e.g., "security", "dead_code")'),
      language: z.string().optional().describe('Filter by language (e.g., "typescript", "python")'),
    },
  },
  async (args) => {
    let patterns = catalog.map(entry => entry.definition);

    if (args.category) {
      patterns = patterns.filter(p => p.category === args.category);
    }
    if (args.language) {
      patterns = patterns.filter(p => p.languages.includes(args.language!));
    }

    const customPatternList = Array.from(customPatterns.values());
    // Apply same filters to custom patterns
    let filteredCustom = customPatternList;
    if (args.category) {
      filteredCustom = filteredCustom.filter(p => p.category === args.category);
    }
    if (args.language) {
      filteredCustom = filteredCustom.filter(p => p.languages.includes(args.language!));
    }

    const result = {
      version: '0.1.0',
      patterns: [...patterns, ...filteredCustom],
      totalBuiltin: catalog.length,
      totalCustom: customPatternList.length,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── Tool: pattern_miner.learn_pattern ───────────────────
server.registerTool(
  'pattern_miner.learn_pattern',
  {
    description: 'Register a custom pattern definition for use in future scans.',
    inputSchema: {
      name: z.string().min(1).describe('Pattern name'),
      description: z.string().describe('Pattern description'),
      category: z.string().describe('Pattern category'),
      severity: z.string().optional().describe('Severity level'),
      languages: z.array(z.string()).optional().describe('Target languages'),
      pattern: z.string().describe('The regex or pattern to match'),
      message_template: z.string().optional().describe('Template for the finding message'),
      remediation: z.string().optional().describe('Remediation advice'),
      examples: z.array(z.object({
        before: z.string(),
        after: z.string().optional(),
        description: z.string().optional(),
      })).optional().describe('Code examples'),
    },
  },
  async (args) => {
    const id = `custom-${args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    const definition: PatternDefinitionType = {
      id,
      name: args.name,
      description: args.description,
      category: (args.category || 'best_practice') as PatternCategoryType,
      severity: (args.severity || 'warning') as PatternSeverityType,
      languages: args.languages || ['typescript', 'javascript'],
      pattern: args.pattern,
      message_template: args.message_template || `Pattern '${args.name}' matched`,
      remediation: args.remediation || 'No remediation provided.',
      examples: args.examples,
    };

    customPatterns.set(id, definition);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          patternId: id,
          message: `Custom pattern '${args.name}' registered with ID: ${id}`,
        }, null, 2),
      }],
    };
  },
);

// ── Start server ────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('Fatal error starting pattern-miner server:', err);
  process.exit(1);
});
