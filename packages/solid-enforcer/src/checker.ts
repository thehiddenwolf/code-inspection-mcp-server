import type { ViolationType } from '@hermes/shared/schemas/violations.js';

/**
 * Get the 1-indexed line number for a character position in source code.
 */
export function getLineNumber(code: string, position: number): number {
  let line = 1;
  for (let i = 0; i < position && i < code.length; i++) {
    if (code[i] === '\n') line++;
  }
  return line;
}
