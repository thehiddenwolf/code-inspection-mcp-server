/**
 * Tool-specific TypeScript types.
 * These are derived from the Zod schemas in src/schemas/ but exported
 * as plain interfaces for use outside Zod validation contexts.
 */

import type {
  SqueezeInputType,
  SqueezeOutputType,
  TargetLanguage,
  AggressivenessLevel,
  OutputFormat,
  ManifestInputType,
  ManifestOutputType,
  ScanInputType,
  ScanOutputType,
  RouteInputType,
  RouteOutputType,
  ComplexityLevel,
  KnowledgeQueryInputType,
  KnowledgeQueryOutputType,
} from '../schemas/tools.js';
import type { ArchitectureManifestType, ManifestValidationResultType } from '../schemas/manifests.js';
import type { PatternDefinitionType, PatternMatchType, DeadCodeResultType } from '../schemas/patterns.js';
import type { ViolationType, ViolationReportType } from '../schemas/violations.js';

// Re-export all schema-derived types
export type {
  SqueezeInputType,
  SqueezeOutputType,
  TargetLanguage,
  AggressivenessLevel,
  OutputFormat,
  ManifestInputType,
  ManifestOutputType,
  ScanInputType,
  ScanOutputType,
  RouteInputType,
  RouteOutputType,
  ComplexityLevel,
  KnowledgeQueryInputType,
  KnowledgeQueryOutputType,
  ArchitectureManifestType,
  ManifestValidationResultType,
  PatternDefinitionType,
  PatternMatchType,
  DeadCodeResultType,
  ViolationType,
  ViolationReportType,
};

/** Generic tool handler signature */
export type ToolHandler<I, O> = (input: I) => Promise<O> | O;

/** Tool registration entry */
export interface ToolRegistration<I, O> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler<I, O>;
}

/** Squeeze options — fully resolved defaults */
export interface SqueezeOptions {
  preserve_comments: boolean;
  preserve_imports: boolean;
  aggressiveness: AggressivenessLevel;
  include_private: boolean;
  output_format: OutputFormat;
  max_tokens?: number;
}

/** ArchitectureShepherd check input */
export interface ArchitectureCheckInput {
  paths: string[];
  manifest_id: string;
}

/** ArchitectureShepherd check diff input */
export interface ArchitectureCheckDiffInput {
  diff: string;
  manifest_id: string;
}

/** PatternMiner scan options */
export interface PatternFilter {
  categories?: string[];
  severities?: string[];
  pattern_ids?: string[];
  include?: string[];
  exclude?: string[];
}

/** TaskRouter complexity metrics */
export interface ComplexityMetrics {
  cyclomatic: number;
  dependency_depth: number;
  interface_surface: number;
  loc: number;
}

/** TaskRouter routing recommendation */
export interface RoutingRecommendation {
  tier: 'junior' | 'mid' | 'senior' | 'expert';
  model: string;
  confidence: number;
  reasoning: string;
}

/** SOLIDEnforcer audit check result */
export interface SolidCheckResult {
  principle: string;
  passed: boolean;
  score: number;
  violations: ViolationType[];
  details: string;
}
