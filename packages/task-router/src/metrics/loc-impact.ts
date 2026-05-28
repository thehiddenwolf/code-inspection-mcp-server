import { MetricResult } from '../types.js';
import { Metric } from './metric.js';

/**
 * LOC Impact metric — measures the scale of a code unit by its line count.
 *
 * Why this matters: sheer size is a reliable proxy for cognitive load and
 * review effort. A 500-line function is almost always harder to reason about
 * than a 20-line one, regardless of cyclomatic complexity.
 *
 * Scoring dimensions:
 *   - Total logical lines (excluding blanks and pure comments)
 *   - Average function/method size (lines per function)
 *   - Largest function/method size
 *   - File size category penalty (small/medium/large/massive)
 *
 * Scores are normalised to 0–100.
 */

interface FunctionBounds {
  start: number;
  end: number;
}

export class LocImpactMetric implements Metric {
  readonly name = 'loc-impact';

  compute(code: string, _language?: string): MetricResult {
    const normalized = code.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    // --- Logical lines (exclude blanks and pure-comment lines) ---
    const logicalLines = lines.filter((l) => {
      const trimmed = l.trim();
      if (trimmed.length === 0) return false;
      if (trimmed.startsWith('//')) return false;
      if (trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
      return true;
    });

    const totalLogical = logicalLines.length;

    // --- Function/method boundaries ---
    // Lightweight brace-matching heuristic for C-family languages.
    // Matches `function name(`, `name(`, `methodName(`, arrow-assign patterns.
    const functionHeaders: { name: string; line: number }[] = [];
    const fnHeaderRe =
      /\b(?:function\s+\w+|(?:async\s+)?\w+\s*=\s*(?:async\s*)?\(|^\s*(?:export\s+)?(?:async\s+)?(?:function\s+)?\w+\s*\()/gm;

    // Reset and capture function-like patterns with line numbers
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip comments, strings
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;

      // Reset regex per line
      fnHeaderRe.lastIndex = 0;
      const matches = line.match(fnHeaderRe);
      if (matches) {
        // Filter out keywords that aren't function declarations
        const clean = matches.filter((m) => {
          const kw = ['if ', 'while ', 'for ', 'switch ', 'catch ', 'return '];
          return !kw.some((k) => m.startsWith(k));
        });
        if (clean.length > 0) {
          functionHeaders.push({ name: clean[0].trim(), line: i });
        }
      }
    }

    // --- Estimate function sizes via brace matching ---
    const functionSizes: number[] = [];
    const braceStack: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const ch of line) {
        if (ch === '{') braceStack.push(i);
        else if (ch === '}') {
          if (braceStack.length > 0) {
            const openLine = braceStack.pop()!;
            // Check if this brace pair belongs to a function
            const fn = functionHeaders.find(
              (f) => f.line === openLine || f.line === openLine - 1,
            );
            if (fn) {
              functionSizes.push(i - openLine + 1);
            }
          }
        }
      }
    }

    // Fallback: if brace matching didn't catch functions, estimate by file size
    const avgFunctionSize =
      functionSizes.length > 0
        ? functionSizes.reduce((a, b) => a + b, 0) / functionSizes.length
        : totalLogical;

    const maxFunctionSize =
      functionSizes.length > 0 ? Math.max(...functionSizes) : totalLogical;

    // --- Scoring ---

    // Base score from total logical lines (0-40 pts, 80+ lines = 40)
    const sizeScore = Math.min(40, (totalLogical / 80) * 40);

    // Average function size penalty (0-25 pts, avg > 50 lines = 25)
    const avgFnPenalty =
      avgFunctionSize > 50 ? 25 : Math.min(25, (avgFunctionSize / 50) * 25);

    // Largest function penalty (0-25 pts, max > 200 lines = 25)
    const maxFnPenalty =
      maxFunctionSize > 200
        ? 25
        : Math.min(25, (maxFunctionSize / 200) * 25);

    // File size category bonus (0-10 pts)
    let categoryPts = 0;
    let category = 'small';
    if (totalLogical > 500) {
      categoryPts = 10;
      category = 'massive';
    } else if (totalLogical > 200) {
      categoryPts = 7;
      category = 'large';
    } else if (totalLogical > 80) {
      categoryPts = 4;
      category = 'medium';
    }

    const rawScore = sizeScore + avgFnPenalty + maxFnPenalty + categoryPts;
    const capped = Math.min(rawScore, 100);

    const parts: string[] = [
      `Logical lines: ${totalLogical} (${category}) → ${sizeScore.toFixed(1)} pts`,
    ];
    if (functionSizes.length > 0) {
      parts.push(
        `Functions: ${functionSizes.length}, avg ${avgFunctionSize.toFixed(0)} lines → ${avgFnPenalty.toFixed(1)} pts`,
      );
      parts.push(
        `Largest function: ${maxFunctionSize} lines → ${maxFnPenalty.toFixed(1)} pts`,
      );
    }
    parts.push(`Category penalty: ${category} → ${categoryPts} pts`);

    const details = `LOC impact: ${capped.toFixed(1)}/100 (${parts.join('; ')})`;

    return {
      name: this.name,
      score: Math.round(capped * 10) / 10,
      details,
    };
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name };
  }
}
