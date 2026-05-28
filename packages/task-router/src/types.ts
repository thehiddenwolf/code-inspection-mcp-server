import { z } from 'zod';

// ---- Core domain types ----

/** The tier of model recommended for a task based on complexity */
export enum RoutingTier {
  /** Tier 1: Simple tasks, fast/cheap models (score 0-15) */
  Junior = 1,
  /** Tier 2: Moderate tasks, balanced models (score 16-40) */
  Mid = 2,
  /** Tier 3: Complex tasks, capable models (score 41-80) */
  Senior = 3,
  /** Tier 4: Expert-level tasks, most capable models (score 81+) */
  Expert = 4,
}

/** Individual metric result from a single analysis dimension */
export interface MetricResult {
  /** Name of the metric (e.g. "cyclomatic", "dependencies", "interface-surface") */
  name: string;
  /** Numeric score contributed by this metric */
  score: number;
  /** Human-readable breakdown of the calculation */
  details: string;
}

/** Aggregate complexity score computed from code or plan analysis */
export interface ComplexityScore {
  /** Total aggregate score */
  total: number;
  /** Individual metric breakdowns */
  metrics: MetricResult[];
  /** Recommended tier based on thresholds */
  tier: RoutingTier;
  /** Human-readable reasoning for the recommendation */
  reasoning: string;
}

/** A task that can be routed to a model */
export interface Task {
  /** Unique identifier for the task */
  id: string;
  /** Human-readable title */
  title: string;
  /** Long-form description of what needs to be done */
  description: string;
  /** Complexity score if already analyzed */
  complexity?: ComplexityScore;
  /** Which tier this task is routed to */
  tier?: RoutingTier;
  /** Subtasks if the task has been decomposed */
  subtasks?: Task[];
}

/** Supported analysis target types */
export type AnalysisTargetType = 'file' | 'code' | 'plan';

/** Input spec for the analyzer */
export interface AnalysisTarget {
  /** Path to a source file on disk (for 'file' type) */
  path?: string;
  /** Raw source code string (for 'code' type) */
  code?: string;
  /** Architectural plan text (for 'plan' type) */
  plan?: string;
  /** The type of target being analyzed */
  type: AnalysisTargetType;
  /** Optional language hint for AST-based analysis */
  language?: string;
}

// ---- Zod schemas for MCP tool inputs/outputs ----

export const AnalysisTargetSchema = z.object({
  path: z.string().optional().describe('Path to the source file on disk'),
  code: z.string().optional().describe('Raw source code string'),
  plan: z.string().optional().describe('Architectural plan or description text'),
  type: z.enum(['file', 'code', 'plan']).describe('Type of analysis target'),
  language: z.string().optional().describe('Programming language hint for AST analysis (e.g. typescript, javascript)'),
});

export const MetricResultSchema = z.object({
  name: z.string().describe('Name of the metric (e.g. "cyclomatic", "dependencies")'),
  score: z.number().min(0).max(100).describe('Numeric score for this metric dimension'),
  details: z.string().describe('Human-readable breakdown of the calculation'),
});

export const ComplexityScoreSchema: z.ZodObject<any> = z.object({
  total: z.number().describe('Total aggregate complexity score'),
  metrics: z.array(MetricResultSchema).describe('Individual metric breakdowns'),
  tier: z.nativeEnum(RoutingTier).describe('Recommended model tier'),
  reasoning: z.string().describe('Human-readable recommendation reasoning'),
});

export const TaskSchema: z.ZodObject<any> = z.object({
  id: z.string().describe('Unique task identifier'),
  title: z.string().describe('Human-readable task title'),
  description: z.string().describe('Task description'),
  complexity: ComplexityScoreSchema.optional().describe('Pre-computed complexity score'),
  tier: z.nativeEnum(RoutingTier).optional().describe('Routing tier'),
  subtasks: z.array(z.lazy(() => TaskSchema)).optional().describe('Subtasks'),
});

// ---- Threshold override types ----

export interface ThresholdOverrides {
  /** Override the upper bound for Tier 1 (Junior) — default 15 */
  tier1Max?: number;
  /** Override the upper bound for Tier 2 (Mid) — default 40 */
  tier2Max?: number;
  /** Override the upper bound for Tier 3 (Senior) — default 80 */
  tier3Max?: number;
}

export const ThresholdOverridesSchema = z.object({
  tier1Max: z.number().min(1).optional().describe('Override Tier 1 max score (default 15)'),
  tier2Max: z.number().min(1).optional().describe('Override Tier 2 max score (default 40)'),
  tier3Max: z.number().min(1).optional().describe('Override Tier 3 max score (default 80)'),
});
