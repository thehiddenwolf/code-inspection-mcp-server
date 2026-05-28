import { z } from 'zod';

/**
 * Violation report schemas — shared across ArchitectureShepherd, PatternMiner, SOLIDEnforcer.
 */

export const ViolationSeverity = z.enum(['critical', 'error', 'warning', 'info']);
export type ViolationSeverityType = z.infer<typeof ViolationSeverity>;

export const ViolationLocation = z.object({
  file: z.string(),
  line: z.number().int().nonnegative().optional(),
  column: z.number().int().nonnegative().optional(),
  end_line: z.number().int().nonnegative().optional(),
  end_column: z.number().int().nonnegative().optional(),
  snippet: z.string().optional(),
});
export type ViolationLocationType = z.infer<typeof ViolationLocation>;

export const Violation = z.object({
  id: z.string().optional(),
  rule_id: z.string(),
  rule_name: z.string(),
  severity: ViolationSeverity,
  message: z.string(),
  locations: z.array(ViolationLocation).min(1),
  remediation: z.string().optional(),
  category: z.enum([
    'dependency',
    'layer_boundary',
    'naming',
    'file_size',
    'solid_srp',
    'solid_ocp',
    'solid_lsp',
    'solid_isp',
    'solid_dip',
    'anti_pattern',
    'security',
    'performance',
    'duplication',
    'architecture',
    'other',
  ]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ViolationType = z.infer<typeof Violation>;

export const ViolationSummary = z.object({
  total_violations: z.number().int().nonnegative(),
  by_severity: z.object({
    critical: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
  }),
  by_category: z.record(z.string(), z.number().int().nonnegative()),
  passed: z.boolean(),
});
export type ViolationSummaryType = z.infer<typeof ViolationSummary>;

export const ViolationReport = z.object({
  scan_id: z.string(),
  timestamp: z.string().datetime(),
  target: z.string(),
  violations: z.array(Violation),
  summary: ViolationSummary,
});
export type ViolationReportType = z.infer<typeof ViolationReport>;
