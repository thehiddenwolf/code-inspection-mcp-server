import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

const DEFAULT_THRESHOLD = 3;

/**
 * Detect magic numbers — numeric literals used directly in code
 * without being assigned to a named constant.
 * Threshold: numbers >= some value (default 3) unless they're
 * 0, 1, -1 or used in specific allowed contexts.
 */
export async function detectMagicNumbers(
  files: { path: string; content: string }[],
  threshold: number = DEFAULT_THRESHOLD,
): Promise<PatternMatchType[]> {
  const findings: PatternMatchType[] = [];

  // Match numeric literals that aren't in certain "safe" contexts
  const numberRegex = /(?<!\w)(-?\d+(?:\.\d+)?)(?!\w)/g;

  // Contexts where numbers are typically acceptable
  const allowedContextRegex = /(?:^(?:const|let|var)\s+\w+\s*=|(?::\s*(?:number|string)\s*=\s*)|(?:\b(?:length|index|offset|count|size|limit|max|min|width|height|x|y|z|i|j|k|idx)\s*(?:[=<>!]+|:)\s*))/i;

  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(file.path)) continue;

    const lines = file.content.split('\n');
    let inBlockComment = false;
    const commentLines = new Set<number>();
    const stringLines = new Set<number>();

    // Track comment/string lines
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
      // Track template literals and string contexts
      if (line.includes('`') && (line.match(/`/g)?.length || 0) % 2 !== 0) {
        stringLines.add(i);
      }
      const blockStart = line.indexOf('/*');
      if (blockStart !== -1) {
        commentLines.add(i);
        if (!line.includes('*/', blockStart + 2)) inBlockComment = true;
      }
    }

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      if (commentLines.has(lineIdx)) continue;
      if (stringLines.has(lineIdx)) continue;

      const line = lines[lineIdx];

      // Skip lines that look like const/let definitions (they're probably named constants)
      if (/^(const|let|var)\s+\w+\s*=/.test(line.trim())) continue;

      // Skip import statements
      if (/^import\s/.test(line.trim())) continue;

      // Skip type annotations / interface definitions
      if (/^type\s+\w+\s*=/.test(line.trim())) continue;

      numberRegex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = numberRegex.exec(line)) !== null) {
        const numStr = match[1];
        const num = parseFloat(numStr);

        // Skip 0, 1, -1, and obviously safe numbers
        if (num === 0 || num === 1 || num === -1) continue;
        if (Math.abs(num) < threshold && num !== Math.floor(num)) continue;

        // Check context before the number to see if it's in an allowed position
        const beforeText = line.substring(0, match.index).trim();
        if (beforeText.endsWith('[') || beforeText.endsWith('(') || beforeText.endsWith(',')) continue;

        // Check if it's preceded by a known-allowed keyword
        if (/\.(?:length|size|count|limit|offset|index|i|j|k)\s*[=<>!]/.test(beforeText)) continue;
        if (/:\s*(?:number|string|any)\s*=\s*$/.test(beforeText)) continue;

        // Skip array indices (0, 1 used as indices in many contexts)
        if (Math.abs(num) <= 1) continue;

        const context = line.trim().substring(0, 80);

        findings.push({
          pattern_id: 'magic-numbers',
          pattern_name: 'Magic Number',
          file_path: file.path,
          line: lineIdx + 1,
          column: match.index,
          message: `Magic number '${numStr}' detected — assign to a named constant`,
          severity: 'info' as PatternSeverityType,
          category: 'style' as PatternCategoryType,
          snippet: context,
        });
      }
    }
  }

  return findings;
}
