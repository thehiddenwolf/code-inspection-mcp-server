import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

/**
 * Detect `any` type annotations in TypeScript files.
 */
export async function detectAnyUsage(
  files: { path: string; content: string }[],
): Promise<PatternMatchType[]> {
  const findings: PatternMatchType[] = [];

  // Pattern to match `any` type annotations — but not `any` inside comments/strings
  const anyRegex = /:\s*any\b/g;
  const asAnyRegex = /as\s+any\b/g;
  const genericAnyRegex = /<any>/g;

  for (const file of files) {
    // Only scan TypeScript files
    if (!/\.(ts|tsx|mts|cts)$/.test(file.path)) continue;

    const lines = file.content.split('\n');

    // Track which lines are inside comments
    let inBlockComment = false;
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
        if (!line.includes('*/', blockStart + 2)) {
          inBlockComment = true;
        }
        continue;
      }
    }

    // Scan for `any` type annotations
    let match: RegExpExecArray | null;

    while ((match = anyRegex.exec(file.content)) !== null) {
      const lineNum = file.content.substring(0, match.index).split('\n').length - 1;
      if (commentLines.has(lineNum)) continue;

      const column = file.content.substring(0, match.index).split('\n').pop()?.length || 0;
      // Get context
      const lineText = lines[lineNum];
      const context = lineText?.trim().substring(0, 80) || '';

      findings.push({
        pattern_id: 'any-usage',
        pattern_name: 'Any Type Usage',
        file_path: file.path,
        line: lineNum + 1,
        column,
        message: `TypeScript 'any' type used — consider a more specific type`,
        severity: 'warning',
        category: 'best_practice',
        snippet: context,
      });
    }

    // Scan for `as any` casts
    while ((match = asAnyRegex.exec(file.content)) !== null) {
      const lineNum = file.content.substring(0, match.index).split('\n').length - 1;
      if (commentLines.has(lineNum)) continue;

      const lineText = lines[lineNum];
      const context = lineText?.trim().substring(0, 80) || '';

      findings.push({
        pattern_id: 'any-usage',
        pattern_name: 'Any Type Usage',
        file_path: file.path,
        line: lineNum + 1,
        column: 0,
        message: `Type assertion 'as any' bypasses type safety`,
        severity: 'warning',
        category: 'best_practice',
        snippet: context,
      });
    }
  }

  return findings;
}
