import { RoutingTier, ThresholdOverrides } from './types.js';

/**
 * Default tier thresholds and model recommendations.
 *
 * Tier 1  (Junior, score 0-15):  fast/cheap models
 * Tier 2  (Mid,    score 16-40): balanced models
 * Tier 3  (Senior, score 41-80): capable models
 * Tier 4  (Expert, score 81+):   most capable models
 */

export interface TierDefinition {
  /** The routing tier enum value */
  tier: RoutingTier;
  /** Human-readable label */
  label: string;
  /** Lower bound (inclusive) */
  minScore: number;
  /** Upper bound (inclusive) */
  maxScore: number;
  /** Recommended model keys for this tier */
  recommendedModels: string[];
  /** Usage guidance */
  guidance: string;
}

const DEFAULT_TIERS: TierDefinition[] = [
  {
    tier: RoutingTier.Junior,
    label: 'Junior',
    minScore: 0,
    maxScore: 15,
    recommendedModels: [
      'groq/llama-3.2-3b',
      'groq/llama-3.1-8b',
      'ollama/qwen2.5-coder-1.5b',
      'ollama/phi-3-mini',
    ],
    guidance:
      'Suitable for trivial tasks: single-file edits, straightforward bug fixes, ' +
      'simple data transformations, basic code generation under 50 lines.',
  },
  {
    tier: RoutingTier.Mid,
    label: 'Mid',
    minScore: 16,
    maxScore: 40,
    recommendedModels: [
      'groq/llama-3.1-70b',
      'openai/gpt-4o-mini',
      'anthropic/claude-3-haiku',
      'ollama/qwen2.5-coder-7b',
    ],
    guidance:
      'Appropriate for moderate-complexity tasks: multi-file features, ' +
      'refactoring across a few modules, code review, test generation, ' +
      'documentation updates, moderate API integrations.',
  },
  {
    tier: RoutingTier.Senior,
    label: 'Senior',
    minScore: 41,
    maxScore: 80,
    recommendedModels: [
      'openai/gpt-4o',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.0-flash',
      'deepseek/deepseek-coder-v2',
    ],
    guidance:
      'Intended for complex tasks: cross-cutting architectural changes, ' +
      'performance optimization, database schema design, new subsystem ' +
      'implementation, security-critical code, multi-service orchestration.',
  },
  {
    tier: RoutingTier.Expert,
    label: 'Expert',
    minScore: 81,
    maxScore: Infinity,
    recommendedModels: [
      'openai/o3',
      'anthropic/claude-3.5-opus',
      'google/gemini-2.0-pro',
      'deepseek/deepseek-r1',
    ],
    guidance:
      'Reserved for expert-level work: full architectural rewrites, ' +
      'novel algorithm implementation, safety-critical systems, ' +
      'formal verification, third-party library authoring, ' +
      'complex distributed systems design.',
  },
];

/**
 * Routing table — computes tier from score with optional threshold overrides.
 */
export class RoutingTable {
  private tiers: TierDefinition[];

  constructor(overrides?: ThresholdOverrides) {
    this.tiers = this.buildTiers(overrides);
  }

  /**
   * Determine which tier a given score falls into.
   */
  getTier(score: number): RoutingTier {
    for (const t of this.tiers) {
      if (score >= t.minScore && score <= t.maxScore) {
        return t.tier;
      }
    }
    // Fallback: if score exceeds all maxes, return Expert
    return RoutingTier.Expert;
  }

  /**
   * Get the full tier definition for a given score.
   */
  getTierDefinition(score: number): TierDefinition {
    for (const t of this.tiers) {
      if (score >= t.minScore && score <= t.maxScore) {
        return t;
      }
    }
    return this.tiers[this.tiers.length - 1];
  }

  /**
   * Get all tier definitions (useful for serialization / debugging).
   */
  getAllTiers(): TierDefinition[] {
    return [...this.tiers];
  }

  /**
   * Generate a human-readable routing explanation for a score.
   */
  explainRouting(score: number): string {
    const def = this.getTierDefinition(score);
    const tierName = RoutingTier[def.tier];
    return (
      `Score ${score} → **Tier ${def.tier} (${tierName})**\n` +
      `Recommended models: ${def.recommendedModels.join(', ')}\n` +
      `Guidance: ${def.guidance}`
    );
  }

  private buildTiers(overrides?: ThresholdOverrides): TierDefinition[] {
    const t1Max = overrides?.tier1Max ?? 15;
    const t2Max = overrides?.tier2Max ?? 40;
    const t3Max = overrides?.tier3Max ?? 80;

    return [
      { ...DEFAULT_TIERS[0], maxScore: t1Max },
      { ...DEFAULT_TIERS[1], minScore: t1Max, maxScore: t2Max },
      { ...DEFAULT_TIERS[2], minScore: t2Max, maxScore: t3Max },
      { ...DEFAULT_TIERS[3], minScore: t3Max, maxScore: Infinity },
    ];
  }
}
