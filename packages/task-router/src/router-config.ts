import { z } from 'zod';
import { ThresholdOverrides } from './types.js';

/**
 * RouterConfig — configurable routing parameters loaded from a JSON file.
 *
 * Default path: task-router.config.json in the CWD or a custom path.
 * All fields are optional — defaults are sensible for general use.
 */
export interface RouterConfig {
  /** Metric weights for the three core routing metrics */
  metricWeights?: {
    cyclomatic?: number;
    'loc-impact'?: number;
    density?: number;
    /** Secondary metrics (merged from all 5) */
    dependencies?: number;
    'interface-surface'?: number;
  };
  /** Tier boundary overrides */
  thresholds?: ThresholdOverrides;
  /** Model assignments per tier (overrides built-in defaults) */
  tierModels?: Record<string, string[]>;
  /** Model selector algorithm: 'weighted' (default) or 'strict' */
  algorithm?: 'weighted' | 'strict';
  /** When true, includes full metric breakdown in routing result */
  verbose?: boolean;
}

export const RouterConfigSchema = z.object({
  metricWeights: z.object({
    cyclomatic: z.number().min(0).max(1).optional(),
    'loc-impact': z.number().min(0).max(1).optional(),
    density: z.number().min(0).max(1).optional(),
    dependencies: z.number().min(0).max(1).optional(),
    'interface-surface': z.number().min(0).max(1).optional(),
  }).optional(),
  thresholds: z.object({
    tier1Max: z.number().min(1).optional(),
    tier2Max: z.number().min(1).optional(),
    tier3Max: z.number().min(1).optional(),
  }).optional(),
  tierModels: z.record(z.string(), z.array(z.string())).optional(),
  algorithm: z.enum(['weighted', 'strict']).optional(),
  verbose: z.boolean().optional(),
});

/**
 * Default router configuration — balanced for general coding tasks.
 */
export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  metricWeights: {
    cyclomatic: 0.40,
    'loc-impact': 0.25,
    density: 0.15,
    dependencies: 0.12,
    'interface-surface': 0.08,
  },
  algorithm: 'weighted',
  verbose: false,
};

/**
 * Load router configuration from a JSON file.
 * Returns the merged config (user overrides + defaults).
 */
export async function loadRouterConfig(path?: string): Promise<RouterConfig> {
  // If no path given, try default locations
  const candidates = path
    ? [path]
    : [
        'task-router.config.json',
        '.task-router.config.json',
        'config/task-router.config.json',
      ];

  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(candidate, 'utf-8');
      const parsed = JSON.parse(content);
      const validated = RouterConfigSchema.parse(parsed);
      return mergeConfig(validated as RouterConfig);
    } catch (error: unknown) {
      // If it's not a file-not-found, capture the error
      if (error instanceof Error && !error.message.includes('ENOENT')) {
        lastError = error;
      }
      // Otherwise just continue to next candidate
    }
  }

  // If none found but we had errors that aren't just missing files, surface them
  if (lastError) {
    throw new Error(`Failed to load router config: ${lastError.message}`);
  }

  // No config file found — use defaults
  return { ...DEFAULT_ROUTER_CONFIG };
}

/**
 * Merge user-provided config with defaults.
 * User values take precedence.
 */
export function mergeConfig(userConfig: RouterConfig): RouterConfig {
  return {
    metricWeights: {
      ...DEFAULT_ROUTER_CONFIG.metricWeights,
      ...userConfig.metricWeights,
    },
    thresholds: {
      ...userConfig.thresholds,
    },
    tierModels: userConfig.tierModels
      ? { ...userConfig.tierModels }
      : undefined,
    algorithm: userConfig.algorithm ?? DEFAULT_ROUTER_CONFIG.algorithm,
    verbose: userConfig.verbose ?? DEFAULT_ROUTER_CONFIG.verbose,
  };
}
