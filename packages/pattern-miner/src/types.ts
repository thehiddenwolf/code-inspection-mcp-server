import type { PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

/**
 * Types for the pattern-miner MCP server.
 */

export interface Finding {
  patternId: string;
  patternName: string;
  filePath: string;
  line: number;
  column?: number;
  endLine?: number;
  message: string;
  severity: PatternSeverityType;
  category?: PatternCategoryType;
  snippet?: string;
}

export interface ScanReport {
  scanId: string;
  timestamp: string;
  durationMs: number;
  filesScanned: number;
  totalFindings: number;
  findingsBySeverity: Record<string, number>;
  findings: Finding[];
}

export interface PatternFilter {
  categories?: PatternCategoryType[];
  severities?: PatternSeverityType[];
  languages?: string[];
  patternIds?: string[];
}


