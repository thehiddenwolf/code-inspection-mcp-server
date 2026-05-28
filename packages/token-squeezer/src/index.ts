#!/usr/bin/env node

/**
 * TokenSqueezer MCP Server
 *
 * MCP server that provides source code token reduction via structural skeletons.
 * Registers one tool: `token_squeezer.squeeze`
 *
 * Uses StdioServerTransport for communication.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SqueezeInput, SqueezeOutput, LanguageEnum } from '@hermes/shared';
import { squeeze } from './squeezer.js';

const PACKAGE_VERSION = '0.1.0';

// Create the MCP server
const server = new McpServer(
  {
    name: '@hermes/token-squeezer',
    version: PACKAGE_VERSION,
  },
  {
    capabilities: {
      tools: {
        listChanged: true,
      },
    },
  },
);

// Register the squeeze tool
server.registerTool('token_squeezer_squeeze', {
  description: 'Reduce source code token count by returning structural skeletons via Tree-sitter AST manipulation (or regex fallback)',
  inputSchema: SqueezeInput,
  outputSchema: SqueezeOutput,
}, async (args, _extra) => {
  try {
    // Validate and parse input
    const input = SqueezeInput.parse(args);

    const language = input.language;
    const code = input.code;

    // Validate language
    const validLanguages = LanguageEnum.options;
    if (!validLanguages.includes(language as typeof validLanguages[number])) {
      return {
        content: [{
          type: 'text' as const,
          text: `Unsupported language: "${language}". Supported languages: ${validLanguages.join(', ')}`,
        }],
        isError: true,
      };
    }

    // Run the squeezer
    const result = await squeeze(code, language, input.options);

    // Format output based on requested format
    const format = input.options?.output_format ?? 'text';

    if (format === 'json' || format === 'both') {
      const jsonResult = SqueezeOutput.parse(result);
      if (format === 'json') {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(jsonResult, null, 2),
          }],
        };
      }
      // both: return text + JSON
      return {
        content: [
          {
            type: 'text' as const,
            text: result.squeezed,
          },
          {
            type: 'text' as const,
            text: `\n--- Metrics ---\nTokens: ${result.original_tokens} → ${result.squeezed_tokens} (${(result.reduction_ratio * 100).toFixed(1)}% reduction)\nAggressiveness: ${result.aggressiveness}\nLanguage: ${result.language}`,
          },
        ],
      };
    }

    // text format (default): return the squeezed code
    return {
      content: [
        {
          type: 'text' as const,
          text: result.squeezed,
        },
      ],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text' as const,
        text: `TokenSqueezer error: ${message}`,
      }],
      isError: true,
    };
  }
});

// Start the server
async function main(): Promise<void> {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`TokenSqueezer failed to start: ${message}`);
    process.exit(1);
  }
}

main();
