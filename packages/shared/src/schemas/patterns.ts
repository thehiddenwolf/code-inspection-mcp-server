import { z } from 'zod';

/**
 * Code pattern definitions — for the pattern miner subsystem.
 */

export const PatternSeverity = z.enum(['info', 'warning', 'error', 'critical']);
export type PatternSeverityType = z.infer<typeof PatternSeverity>;

export const PatternCategory = z.enum([
  'security',
  'performance',
  'correctness',
  'style',
  'complexity',
  'duplication',
  'dead_code',
  'architecture',
  'best_practice',
]);
export type PatternCategoryType = z.infer<typeof PatternCategory>;

export const PatternDefinition = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category: PatternCategory,
  severity: PatternSeverity,
  languages: z.array(z.string()),
  pattern: z.string(),
  message_template: z.string(),
  remediation: z.string().optional(),
  examples: z
    .array(
      z.object({
        before: z.string(),
        after: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});
export type PatternDefinitionType = z.infer<typeof PatternDefinition>;

export const PatternCatalog = z.object({
  version: z.string(),
  patterns: z.array(PatternDefinition),
});
export type PatternCatalogType = z.infer<typeof PatternCatalog>;

export const PatternMatch = z.object({
  pattern_id: z.string(),
  pattern_name: z.string(),
  file_path: z.string().optional(),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative().optional(),
  end_line: z.number().int().nonnegative().optional(),
  message: z.string(),
  severity: PatternSeverity,
  category: PatternCategory.optional(),
  snippet: z.string().optional(),
});
export type PatternMatchType = z.infer<typeof PatternMatch>;

export const DeadCodeResult = z.object({
  symbol: z.string(),
  kind: z.enum(['function', 'variable', 'class', 'import', 'type', 'export']),
  file_path: z.string(),
  line: z.number().int().nonnegative(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});
export type DeadCodeResultType = z.infer<typeof DeadCodeResult>;

export const LearnPatternInput = z.object({
  name: z.string().min(1),
  description: z.string(),
  category: PatternCategory,
  severity: PatternSeverity.optional(),
  languages: z.array(z.string()).optional(),
  pattern: z.string(),
  message_template: z.string().optional(),
  remediation: z.string().optional(),
  examples: z
    .array(
      z.object({
        before: z.string(),
        after: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});
export type LearnPatternInputType = z.infer<typeof LearnPatternInput>;
