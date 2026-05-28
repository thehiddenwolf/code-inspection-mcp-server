/**
 * Token counter — character-based approximation.
 * Simple, deterministic, no external dependency needed for v1.
 *
 * Uses the rule-of-thumb: tokens ≈ ceil(chars / 4).
 * This roughly matches GPT-family tokenizer behaviour for code.
 */

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
