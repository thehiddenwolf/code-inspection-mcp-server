import type { ViolationType } from '@hermes/shared/schemas/violations.js';

/**
 * SOLID principle identifiers.
 */
export type SolidPrinciple =
  | 'single_responsibility'
  | 'open_closed'
  | 'liskov_substitution'
  | 'interface_segregation'
  | 'dependency_inversion';

/**
 * All five SOLID principles.
 */
export const ALL_PRINCIPLES: readonly SolidPrinciple[] = [
  'single_responsibility',
  'open_closed',
  'liskov_substitution',
  'interface_segregation',
  'dependency_inversion',
];

/**
 * Human-readable labels for each principle.
 */
export const PRINCIPLE_LABELS: Record<SolidPrinciple, string> = {
  single_responsibility: 'Single Responsibility Principle (SRP)',
  open_closed: 'Open/Closed Principle (OCP)',
  liskov_substitution: 'Liskov Substitution Principle (LSP)',
  interface_segregation: 'Interface Segregation Principle (ISP)',
  dependency_inversion: 'Dependency Inversion Principle (DIP)',
};

/**
 * Configuration for the enforcer.
 */
export interface EnforcerConfig {
  /** Maximum number of switch/if-else branches before flagging OCP (default: 3) */
  maxSwitchBranches?: number;
  /** Minimum number of interface methods before flagging ISP (default: 5) */
  minInterfaceMethods?: number;
  /** Minimum distinct concern areas before flagging SRP (default: 2) */
  minConcernAreas?: number;
  /** Patterns that look like value objects / DTOs (won't flag DIP for these) */
  valueObjectPatterns?: RegExp[];
}

/**
 * Result of checking a single principle.
 */
export interface SinglePrincipleCheck {
  /** The file content being checked */
  code: string;
  /** The file path (for reporting) */
  filePath: string;
  /** Which principle to check */
  principle: SolidPrinciple;
}

/**
 * Result of a full SOLID check.
 */
export interface CheckResult {
  file: string;
  passed: boolean;
  violations: ViolationType[];
  results: PrincipleResult[];
}

/**
 * Result for a single principle.
 */
export interface PrincipleResult {
  principle: SolidPrinciple;
  label: string;
  passed: boolean;
  violations: ViolationType[];
  score: number;
}

export { type ViolationType };
