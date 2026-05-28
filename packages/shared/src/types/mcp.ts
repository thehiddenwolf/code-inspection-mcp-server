import { z } from 'zod';

/**
 * MCP protocol types — transport-level configuration and capabilities.
 */

/** Supported MCP protocol versions */
export const MCP_PROTOCOL_VERSIONS = ['2025-03-26', '2025-04-01'] as const;
export type McpProtocolVersion = (typeof MCP_PROTOCOL_VERSIONS)[number];

/** Transport types */
export const TransportType = {
  Stdio: 'stdio',
  SSE: 'sse',
  StreamableHttp: 'streamable-http',
} as const;
export type TransportType = (typeof TransportType)[keyof typeof TransportType];

/** Transport configuration */
export interface TransportConfig {
  type: TransportType;
  /** For stdio: the command and args */
  command?: string;
  args?: string[];
  /** For SSE/HTTP: the URL */
  url?: string;
  /** Shared */
  env?: Record<string, string>;
}

/** Server capability flags */
export interface ServerCapabilities {
  tools: Record<string, { description: string; inputSchema: Record<string, unknown> }>;
  prompts?: boolean;
  resources?: boolean;
  logging?: boolean;
}

/** MCP tool definition as returned by tools/list */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/** MCP tool call request */
export interface McpToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

/** MCP tool call result */
export interface McpToolCallResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    mimeType?: string;
    data?: string;
    uri?: string;
  }>;
  isError?: boolean;
}

/** Server identity */
export interface McpServerInfo {
  name: string;
  version: string;
  protocolVersion: McpProtocolVersion;
}

/** Tool namespace prefix helper */
export const TOOL_NAMESPACES = {
  TOKEN_SQUEEZER: 'token_squeezer',
  ARCHITECTURE_SHEPHERD: 'architecture_shepherd',
  PATTERN_MINER: 'pattern_miner',
  REPOGRAPH: 'repograph',
  TASK_ROUTER: 'task_router',
  SOLID_ENFORCER: 'solid_enforcer',
} as const;
