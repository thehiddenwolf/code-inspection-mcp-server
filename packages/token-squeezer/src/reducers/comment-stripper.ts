/**
 * comment-stripper.ts
 *
 * Regex-based comment and docstring removal for supported languages.
 * Integrated with the modular Language Pack system.
 */

import { getLanguagePack } from '../utils.js';

export interface StrippedResult {
  cleaned: string;
  removedCount: number;
}

/**
 * Remove comments from source code based on language.
 */
export function stripComments(code: string, language: string): StrippedResult {
  const pack = getLanguagePack(language);
  let result = code;
  let removedCount = 0;

  let patternRegexes: RegExp[] = [];

  if (pack?.regexPatterns?.commentDetection) {
    patternRegexes = [pack.regexPatterns.commentDetection];
  } else {
    const patterns = getCommentPatterns(language);
    patternRegexes = patterns.map(p => new RegExp(p, 'g'));
  }

  for (const regex of patternRegexes) {
    // Ensure only the global flag 'g' is active, do not force dotAll ('s')
    // because that would make '.*' match across newlines and strip the whole file.
    const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
    const dedupedFlags = Array.from(new Set(flags)).join('');
    const runRegex = new RegExp(regex.source, dedupedFlags);

    result = result.replace(runRegex, (match) => {
      removedCount++;
      // Replace with newlines to preserve line numbers
      const lines = match.split('\n');
      return lines.map(() => '').join('\n');
    });
  }

  return { cleaned: result, removedCount };
}

function getCommentPatterns(language: string): string[] {
  switch (language) {
    case 'javascript':
    case 'typescript':
    case 'jsx':
    case 'tsx':
    case 'go':
      return [
        // Line comments
        '//[^\n]*',
        // Block comments (including JSDoc)
        '/\\*[\\s\\S]*?\\*/',
      ];
    case 'python':
      return [
        // Hash comments
        '#[^\n]*',
        // Triple-double-quoted docstrings
        '"""\\n[\\s\\S]*?"""',
        // Triple-single-quoted docstrings
        "'''\\n[\\s\\S]*?'''",
        // Single-line triple-quoted strings used as docstrings
        '"""[^"]*?"""',
        "'''[^']*?'''",
      ];
    default:
      return [];
  }
}
