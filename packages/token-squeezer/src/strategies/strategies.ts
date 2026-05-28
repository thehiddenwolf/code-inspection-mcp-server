import type { AggressivenessLevel } from '@hermes/shared';
import type { SqueezeOptions } from '../types.js';
import { getLanguagePack } from '../utils.js';

export interface StrategyResult {
  squeezed: string;
  strippedNodes: string[];
}

function applyBodyPatterns(
  code: string,
  patterns: BodyPattern[],
  label: string,
  strippedNodes: string[],
): string {
  let result = code;
  for (const pattern of patterns) {
    result = result.replace(pattern.regex, (_match: string, before: string) => {
      strippedNodes.push(`${label} at "${before?.trim().slice(0, 30)}..."`);
      return pattern.replacement.replace('$1', () => before);
    });
  }
  return result;
}

export function applyStrategy(
  code: string,
  language: string,
  aggressiveness: AggressivenessLevel,
  options: SqueezeOptions,
): StrategyResult {
  switch (aggressiveness) {
    case 'conservative':
      return conservative(code, language, options);
    case 'balanced':
      return balanced(code, language, options);
    case 'aggressive':
      return aggressive(code, language, options);
  }
}

/**
 * Conservative: strip all function/class bodies.
 */
function conservative(code: string, language: string, _options: SqueezeOptions): StrategyResult {
  const strippedNodes: string[] = [];
  const bodyPatterns = getBodyPatterns(language);
  const result = applyBodyPatterns(code, bodyPatterns, 'function body', strippedNodes);
  return { squeezed: result, strippedNodes };
}

/**
 * Balanced: keep public/exported signatures, strip private function bodies.
 */
function balanced(code: string, language: string, options: SqueezeOptions): StrategyResult {
  const strippedNodes: string[] = [];
  let result = code;
  if (!options.include_private) {
    const privatePatterns = getPrivateBodyPatterns(language);
    result = applyBodyPatterns(result, privatePatterns, 'private body', strippedNodes);
  }
  return { squeezed: result, strippedNodes };
}

/**
 * Aggressive: strip all function/class bodies.
 */
function aggressive(code: string, language: string, _options: SqueezeOptions): StrategyResult {
  const strippedNodes: string[] = [];
  const bodyPatterns = getBodyPatterns(language);
  const result = applyBodyPatterns(code, bodyPatterns, 'body', strippedNodes);
  return { squeezed: result, strippedNodes };
}

interface BodyPattern {
  regex: RegExp;
  replacement: string;
}

function getBodyPatterns(language: string): BodyPattern[] {
  const pack = getLanguagePack(language);
  if (pack?.squeezer?.bodyPatterns) {
    return pack.squeezer.bodyPatterns.map(bp => ({
      regex: bp.pattern,
      replacement: bp.replacement,
    }));
  }
  return [];
}

function getPrivateBodyPatterns(language: string): BodyPattern[] {
  const pack = getLanguagePack(language);
  if (pack?.squeezer?.privateBodyPatterns) {
    return pack.squeezer.privateBodyPatterns.map(bp => ({
      regex: bp.pattern,
      replacement: bp.replacement,
    }));
  }
  return [];
}
