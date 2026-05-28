import { MetricResult } from '../types.js';
import { Metric } from './metric.js';
import { CyclomaticMetric } from './cyclomatic.js';
import { DependencyMetric } from './dependencies.js';
import { InterfaceSurfaceMetric } from './interface-surface.js';
import { LocImpactMetric } from './loc-impact.js';
import { DensityMetric } from './density.js';

/**
 * Default metric weights for overall complexity calculation.
 *
 * These weights reflect the relative importance of each metric in
 * determining the final complexity score:
 *   - Cyclomatic complexity: 40% (primary indicator of logical complexity)
 *   - Dependency complexity: 25% (coupling risk)
 *   - Interface surface:     20% (API exposure / cognitive load)
 *   - LOC impact:            10% (code volume / density)
 *   - Dependency density:     5% (import density / external coupling)
 */
export const DEFAULT_METRIC_WEIGHTS: Record<string, number> = {
  cyclomatic: 0.40,
  dependencies: 0.25,
  'interface-surface': 0.20,
  'loc-impact': 0.10,
  density: 0.05,
};

/**
 * MetricRegistry — central orchestrator for collecting and running metrics.
 *
 * Manages a set of Metric implementations, runs them all against source code,
 * and aggregates scores into a combined result with weighted total.
 */
export class MetricRegistry {
  private metrics: Map<string, Metric> = new Map();
  private weights: Record<string, number>;

  constructor(weights?: Record<string, number>) {
    this.weights = { ...DEFAULT_METRIC_WEIGHTS, ...weights };
    this.registerDefaults();
  }

  /** Register a single metric by name */
  register(metric: Metric): void {
    this.metrics.set(metric.name, metric);
  }

  /** Unregister a metric by name */
  unregister(name: string): boolean {
    return this.metrics.delete(name);
  }

  /** Get a registered metric by name */
  get(name: string): Metric | undefined {
    return this.metrics.get(name);
  }

  /** Get all registered metric names */
  getMetricNames(): string[] {
    return Array.from(this.metrics.keys());
  }

  /**
   * Run all registered metrics against source code.
   * Returns individual results plus a weighted total.
   */
  runAll(code: string, language?: string): MetricRegistryResult {
    const results: MetricResult[] = [];

    for (const metric of this.metrics.values()) {
      try {
        const result = metric.compute(code, language);
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          name: metric.name,
          score: 0,
          details: `Error computing metric: ${message}`,
        });
      }
    }

    // Compute weighted total
    let total = 0;
    let totalWeight = 0;

    for (const result of results) {
      const weight = this.weights[result.name] ?? 0;
      total += result.score * weight;
      totalWeight += weight;
    }

    // Normalise in case weights don't sum to 1
    const finalTotal = totalWeight > 0
      ? Math.round((total / totalWeight) * 10) / 10
      : 0;

    return {
      total: finalTotal,
      metrics: results,
    };
  }

  /** Set custom weights (merged with defaults) */
  setWeights(weights: Record<string, number>): void {
    this.weights = { ...DEFAULT_METRIC_WEIGHTS, ...weights };
  }

  /** Get current weight configuration */
  getWeights(): Record<string, number> {
    return { ...this.weights };
  }

  /** Register the default set of metrics */
  private registerDefaults(): void {
    this.register(new CyclomaticMetric());
    this.register(new DependencyMetric());
    this.register(new InterfaceSurfaceMetric());
    this.register(new LocImpactMetric());
    this.register(new DensityMetric());
  }
}

/** Result from running all metrics in the registry */
export interface MetricRegistryResult {
  /** Weighted total complexity score (0–100) */
  total: number;
  /** Individual metric results */
  metrics: MetricResult[];
}
