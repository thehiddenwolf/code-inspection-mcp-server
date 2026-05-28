import { MetricResult } from '../types.js';

/**
 * Core Metric interface — the contract every complexity metric must fulfill.
 *
 * Each metric is a named analyzer that takes source code (or a plan) and
 * returns a MetricResult with a numeric score and human-readable breakdown.
 *
 * The `compute` method is the primary entry point. `toJSON` exists so a
 * registry can serialize metrics in bulk without knowing their concrete type.
 */
export interface Metric {
  /** Canonical metric name (e.g. "cyclomatic", "loc-impact", "density") */
  readonly name: string;

  /**
   * Compute the metric for the given source code.
   *
   * @param code    The source code string to analyse.
   * @param language Optional language hint (e.g. "typescript", "python").
   * @returns       A MetricResult with the score and breakdown.
   */
  compute(code: string, language?: string): MetricResult;

  /**
   * Serialise to a plain object for registry-level aggregation.
   * Default implementation returns { name: this.name }.
   */
  toJSON(): Record<string, unknown>;
}
