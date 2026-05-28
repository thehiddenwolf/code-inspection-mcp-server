import { z } from 'zod';

/**
 * MCP invocation and result event schemas.
 * Captures tool calls, their inputs, outputs, and timing.
 */

export const McpEventSeverity = z.enum(['info', 'warn', 'error', 'debug']);
export type McpEventSeverityType = z.infer<typeof McpEventSeverity>;

export const McpEventMetadata = z.object({
  tool_name: z.string(),
  request_id: z.string().optional(),
  session_id: z.string().optional(),
  timestamp: z.string().datetime(),
  duration_ms: z.number().nonnegative().optional(),
  severity: McpEventSeverity.default('info'),
});
export type McpEventMetadataType = z.infer<typeof McpEventMetadata>;

export const ToolInvocationEvent = z.object({
  event: z.literal('tool.invocation'),
  metadata: McpEventMetadata,
  input: z.record(z.string(), z.unknown()),
});
export type ToolInvocationEventType = z.infer<typeof ToolInvocationEvent>;

export const ToolResultEvent = z.object({
  event: z.literal('tool.result'),
  metadata: McpEventMetadata,
  output: z.unknown(),
  error: z.string().optional(),
  is_error: z.boolean().default(false),
});
export type ToolResultEventType = z.infer<typeof ToolResultEvent>;

export const ToolErrorEvent = z.object({
  event: z.literal('tool.error'),
  metadata: McpEventMetadata,
  code: z.string(),
  message: z.string(),
  stack: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ToolErrorEventType = z.infer<typeof ToolErrorEvent>;

export const ServerStartupEvent = z.object({
  event: z.literal('server.startup'),
  metadata: McpEventMetadata.omit({ tool_name: true }).extend({
    server_name: z.string(),
    version: z.string().optional(),
    transport: z.enum(['stdio', 'sse', 'streamable-http']),
  }),
});
export type ServerStartupEventType = z.infer<typeof ServerStartupEvent>;

export const McpEvent = z.discriminatedUnion('event', [
  ToolInvocationEvent,
  ToolResultEvent,
  ToolErrorEvent,
  ServerStartupEvent,
]);
export type McpEventType = z.infer<typeof McpEvent>;
