/**
 * @hermes/task-router — Heuristic task complexity estimator
 *
 * Estimates complexity level, recommended model, cost, and token usage
 * from a free-form task description string.
 */

export type ComplexityLevel = 'simple' | 'medium' | 'complex';

export interface TaskEstimate {
  complexity: ComplexityLevel;
  recommended_model: string;
  estimated_cost: string;
  estimated_tokens: number;
  confidence: number;
  reasoning: string;
  subtasks?: string[];
}

/**
 * Heuristic task complexity estimator.
 *
 * Scoring:
 *  - Counts "simple" indicator keywords (refactor, rename, add, update, fix, bug, typo, minor)
 *  - Counts "complex" indicator keywords (architect, design, implement, create, system,
 *    multiple, cross-cutting, pipeline, refactor across, migrate, distributed, orchestrate)
 *  - Word count: < 50 → simple, 50-200 → medium, > 200 → complex
 *  - Combines both signals for final classification.
 */
export function estimateComplexity(description: string): TaskEstimate {
  const words = description.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const lower = description.toLowerCase();

  // Simple keywords
  const simpleKeywords = [
    'refactor', 'rename', 'add', 'update', 'small', 'fix', 'bug',
    'typo', 'minor', 'cosmetic', 'tweak', 'bump', 'upgrade',
  ];
  const simpleCount = simpleKeywords.filter(k => lower.includes(k)).length;

  // Complex keywords
  const complexKeywords = [
    'architect', 'design', 'implement', 'create', 'system',
    'multiple', 'cross-cutting', 'pipeline', 'migrate',
    'distributed', 'orchestrate', 'infrastructure', 'platform',
    'framework', 'scalable', 'enterprise', 'comprehensive',
    'multi-service', 'refactor across', 'end-to-end',
  ];
  const complexCount = complexKeywords.filter(k => lower.includes(k)).length;

  // Word-count heuristic
  let wordLevel: ComplexityLevel;
  if (wordCount < 50) {
    wordLevel = 'simple';
  } else if (wordCount <= 200) {
    wordLevel = 'medium';
  } else {
    wordLevel = 'complex';
  }

  // Combine signals
  let complexity: ComplexityLevel;
  let confidence: number;
  let reasoning: string;

  if (complexCount > simpleCount && complexCount >= 2) {
    complexity = 'complex';
    confidence = Math.min(0.95, 0.5 + complexCount * 0.1);
    reasoning = `Found ${complexCount} complex indicator(s) and ${simpleCount} simple indicator(s). Word count: ${wordCount}.`;
  } else if (simpleCount > complexCount && simpleCount >= 2) {
    complexity = 'simple';
    confidence = Math.min(0.9, 0.5 + simpleCount * 0.1);
    reasoning = `Found ${simpleCount} simple indicator(s) and ${complexCount} complex indicator(s). Word count: ${wordCount}.`;
  } else {
    // Fall back to word-count heuristic
    complexity = wordLevel;
    confidence = 0.6;
    reasoning = `Ambiguous keyword signals (simple: ${simpleCount}, complex: ${complexCount}). Using word count (${wordCount}) as primary signal.`;
  }

  // Model recommendation
  const modelMap: Record<ComplexityLevel, string> = {
    simple: 'groq/llama-3.2-3b',
    medium: 'openai/gpt-4o-mini',
    complex: 'openai/gpt-4o',
  };

  // Cost estimation
  const costMap: Record<ComplexityLevel, string> = {
    simple: '< $0.01',
    medium: '$0.01 – $0.05',
    complex: '$0.05 – $0.50',
  };

  // Token estimation
  const tokenMap: Record<ComplexityLevel, number> = {
    simple: 500,
    medium: 4000,
    complex: 32000,
  };

  return {
    complexity,
    recommended_model: modelMap[complexity],
    estimated_cost: costMap[complexity],
    estimated_tokens: tokenMap[complexity],
    confidence: Math.round(confidence * 100) / 100,
    reasoning,
  };
}

/**
 * Simple heuristic subtask extraction.
 * Splits on bullet points, numbered lists, or conjunctions like "and then", "followed by".
 */
export function extractSubtasks(description: string): string[] {
  const lines = description.split('\n');
  const subtasks: string[] = [];

  // Try bullet points first
  for (const line of lines) {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)/);
    if (bulletMatch) {
      subtasks.push(bulletMatch[1]);
    } else if (numberedMatch) {
      subtasks.push(numberedMatch[1]);
    }
  }

  // If no bullet/list items found, try splitting on conjunctions
  if (subtasks.length === 0) {
    const conjunctions: RegExp[] = [
      /(.+?)\s+and\s+then\s+/gi,
      /(.+?)\s+followed\s+by\s+/gi,
    ];
    let remaining = description;
    let foundAny = false;
    for (const pattern of conjunctions) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(remaining)) !== null) {
        const part = match[1].trim();
        if (part.length > 5) subtasks.push(part);
        remaining = remaining.slice(match.index + match[0].length);
        pattern.lastIndex = 0;
        foundAny = true;
      }
    }
    // Only push remaining text if at least one conjunction split was made
    if (foundAny && remaining.trim().length > 5) {
      subtasks.push(remaining.trim());
    }
  }

  return subtasks;
}
