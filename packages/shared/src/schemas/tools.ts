import { z } from 'zod';

// ── Squeeze ────────────────────────────────────────────────────────────────

export const AggressivenessEnum = z.enum(['conservative', 'balanced', 'aggressive']);
export type AggressivenessLevel = z.infer<typeof AggressivenessEnum>;

export const LanguageEnum = z.enum([
  'javascript',
  'typescript',
  'python',
  'go',
  'jsx',
  'tsx',
]);
export type TargetLanguage = z.infer<typeof LanguageEnum>;

export const OutputFormatEnum = z.enum(['text', 'json', 'both']);
export type OutputFormat = z.infer<typeof OutputFormatEnum>;

export const SqueezeInputOptions = z.object({
  preserve_comments: z.boolean().optional(),
  preserve_imports: z.boolean().optional(),
  aggressiveness: AggressivenessEnum.optional(),
  max_tokens: z.number().int().positive().optional(),
  include_private: z.boolean().optional(),
  output_format: OutputFormatEnum.optional(),
});
export type SqueezeInputOptionsType = z.infer<typeof SqueezeInputOptions>;

export const SqueezeInput = z.object({
  code: z.string(),
  language: LanguageEnum,
  options: SqueezeInputOptions.optional(),
});
export type SqueezeInputType = z.infer<typeof SqueezeInput>;

export const SqueezeNodeCounts = z.object({
  original: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
});
export type SqueezeNodeCountsType = z.infer<typeof SqueezeNodeCounts>;

export const SqueezeOutput = z.object({
  original: z.string(),
  squeezed: z.string(),
  original_tokens: z.number().int().nonnegative(),
  squeezed_tokens: z.number().int().nonnegative(),
  reduction_ratio: z.number().min(0).max(1),
  aggressiveness: z.string(),
  language: z.string(),
  node_counts: SqueezeNodeCounts.optional(),
});
export type SqueezeOutputType = z.infer<typeof SqueezeOutput>;

// ── Manifest ───────────────────────────────────────────────────────────────

export const ManifestInput = z.object({
  path: z.string().optional(),
  content: z.string().optional(),
});
export type ManifestInputType = z.infer<typeof ManifestInput>;

export const ManifestOutput = z.object({
  valid: z.boolean(),
  violations: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type ManifestOutputType = z.infer<typeof ManifestOutput>;

// ── Scan ───────────────────────────────────────────────────────────────────

export const ScanInput = z.object({
  code: z.string().optional(),
  file_path: z.string().optional(),
  patterns: z.array(z.string()).optional(),
  include_dead_code: z.boolean().optional(),
});
export type ScanInputType = z.infer<typeof ScanInput>;

export const ScanMatch = z.object({
  pattern: z.string(),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative().optional(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']).optional(),
});
export type ScanMatchType = z.infer<typeof ScanMatch>;

export const ScanOutput = z.object({
  matches: z.array(ScanMatch),
  duration_ms: z.number().nonnegative(),
});
export type ScanOutputType = z.infer<typeof ScanOutput>;

// ── Route ──────────────────────────────────────────────────────────────────

export const RouteConstraints = z.object({
  max_cost: z.number().nonnegative().optional(),
  max_time_ms: z.number().nonnegative().optional(),
  required_languages: z.array(z.string()).optional(),
});
export type RouteConstraintsType = z.infer<typeof RouteConstraints>;

export const RouteInput = z.object({
  task_description: z.string(),
  constraints: RouteConstraints.optional(),
});
export type RouteInputType = z.infer<typeof RouteInput>;

export const ComplexityEnum = z.enum(['simple', 'medium', 'complex']);
export type ComplexityLevel = z.infer<typeof ComplexityEnum>;

export const RouteSubtask = z.object({
  name: z.string(),
  description: z.string().optional(),
  estimated_tokens: z.number().int().nonnegative().optional(),
});
export type RouteSubtaskType = z.infer<typeof RouteSubtask>;

export const RouteOutput = z.object({
  complexity: ComplexityEnum,
  recommended_model: z.string(),
  estimated_cost: z.number().nonnegative(),
  estimated_tokens: z.number().int().nonnegative(),
  subtasks: z.array(RouteSubtask).optional(),
});
export type RouteOutputType = z.infer<typeof RouteOutput>;

// ── Knowledge Query ────────────────────────────────────────────────────────

export const ScopeEnum = z.enum(['file', 'module', 'project']);
export type QueryScope = z.infer<typeof ScopeEnum>;

export const KnowledgeQueryInput = z.object({
  query: z.string(),
  file_path: z.string().optional(),
  scope: ScopeEnum.optional(),
});
export type KnowledgeQueryInputType = z.infer<typeof KnowledgeQueryInput>;

export const KnowledgeQueryResult = z.object({
  content: z.string(),
  file_path: z.string().optional(),
  relevance_score: z.number().min(0).max(1).optional(),
});
export type KnowledgeQueryResultType = z.infer<typeof KnowledgeQueryResult>;

export const KnowledgeQueryOutput = z.object({
  results: z.array(KnowledgeQueryResult),
});
export type KnowledgeQueryOutputType = z.infer<typeof KnowledgeQueryOutput>;

// ── Metrics (complexity analysis) ───────────────────────────────────────────

export const MetricResultSchema = z.object({
  name: z.string().describe('Name of the metric (e.g. "cyclomatic", "dependencies")'),
  score: z.number().min(0).max(100).describe('Numeric score (0-100) for this metric dimension'),
  details: z.string().describe('Human-readable breakdown of the calculation'),
});
export type MetricResultType = z.infer<typeof MetricResultSchema>;

export const MetricRegistryResultSchema = z.object({
  total: z.number().describe('Weighted total complexity score (0-100)'),
  metrics: z.array(MetricResultSchema).describe('Individual metric results'),
});
export type MetricRegistryResultType = z.infer<typeof MetricRegistryResultSchema>;
