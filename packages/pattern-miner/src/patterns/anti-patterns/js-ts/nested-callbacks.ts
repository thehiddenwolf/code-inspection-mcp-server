import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

const MAX_NESTING_DEPTH = 3;

/**
 * Detect callback nesting > 3 levels.
 * Tracks indentation-based nesting of callback functions
 * and reports deeply nested callbacks (callback hell).
 */
export async function detectNestedCallbacks(
  files: { path: string; content: string }[],
  maxDepth: number = MAX_NESTING_DEPTH,
): Promise<PatternMatchType[]> {
  const findings: PatternMatchType[] = [];

  // Callback keywords that indicate nesting
  const callbackKeywords = [
    'function', '=>', '.then(', '.catch(', '.finally(',
    '.map(', '.filter(', '.reduce(', '.forEach(',
    'setTimeout', 'setInterval', 'setImmediate',
    'nextTick', 'addEventListener',
  ];

  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(file.path)) continue;

    const lines = file.content.split('\n');
    let inBlockComment = false;

    // Track comment regions
    const commentLines = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (inBlockComment) {
        commentLines.add(i);
        if (line.includes('*/')) inBlockComment = false;
        continue;
      }
      if (line.trim().startsWith('//')) {
        commentLines.add(i);
        continue;
      }
      const blockStart = line.indexOf('/*');
      if (blockStart !== -1) {
        commentLines.add(i);
        if (!line.includes('*/', blockStart + 2)) inBlockComment = true;
      }
    }

    // Track nesting depth through indentation
    let callbackDepth = 0;
    let depthStartLine = 0;
    let inFunctionBody = false;

    for (let i = 0; i < lines.length; i++) {
      if (commentLines.has(i)) continue;

      const line = lines[i];

      // Detect callback start (a function passed as argument)
      const containsCallback = callbackKeywords.some(kw => line.includes(kw));

      if (containsCallback && !line.trim().startsWith('//')) {
        // Check if this is a function definition (not a callback)
        const isFuncDef = /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(/.test(line);
        const isMethod = /^\s*(?:async\s+)?\w+\s*\([^)]*\)\s*\{/.test(line);

        if (!isFuncDef && !isMethod) {
          // Count open braces on this line
          const openBraces = (line.match(/\{/g) || []).length;
          const closeBraces = (line.match(/\}/g) || []).length;

          // Check for fat arrow with body
          if (line.includes('=>') && /\{/.test(line)) {
            callbackDepth++;
            if (callbackDepth === 1) depthStartLine = i + 1;
          }

          // Check for function keyword
          if (/\bfunction\s*\(/.test(line) || /\.(?:then|catch|finally|map|filter|reduce|forEach)\s*\(/.test(line)) {
            callbackDepth++;
            if (callbackDepth === 1) depthStartLine = i + 1;
          }

          callbackDepth += openBraces - closeBraces;
          if (callbackDepth < 0) callbackDepth = 0;
        }
      }

      // Check for closing braces that reduce depth
      const closeCount = (line.match(/\}/g) || []).length;
      const openCount = (line.match(/\{/g) || []).length;

      // Only reduce depth if this isn't a new callback start
      if (!line.includes('=>') && !/\bfunction\s*\(/.test(line)) {
        // Simple brace counting for non-callback lines
        if (closeCount > openCount) {
          callbackDepth = Math.max(0, callbackDepth - (closeCount - openCount));
        }
      }

      // Report if depth exceeds max
      if (callbackDepth > maxDepth) {
        const context = line.trim().substring(0, 80);
        findings.push({
          pattern_id: 'nested-callbacks',
          pattern_name: 'Nested Callbacks',
          file_path: file.path,
          line: i + 1,
          column: 0,
          message: `Callback nesting depth of ${callbackDepth} exceeds max ${maxDepth} — consider refactoring with async/await or Promises`,
          severity: 'warning' as PatternSeverityType,
          category: 'complexity' as PatternCategoryType,
          snippet: context,
        });
      }
    }
  }

  return findings;
}
