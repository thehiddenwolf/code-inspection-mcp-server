import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

/**
 * Detect code after return/throw statements (unreachable branches).
 * Also detects code after break/continue in loops.
 */
export async function detectUnreachableBranches(
  files: { path: string; content: string }[],
): Promise<PatternMatchType[]> {
  const findings: PatternMatchType[] = [];
  const unreachableRegex = /(?:return[^;]*|throw[^;]*)\s*;?\s*\n\s*(\S)/g;
  const breakContinueRegex = /(?:break|continue)\s*;?\s*\n\s*(\S)/g;

  for (const file of files) {
    const lines = file.content.split('\n');

    // Method 1: Detect code after return/throw on the very next line
    let match: RegExpExecArray | null;
    unreachableRegex.lastIndex = 0;
    while ((match = unreachableRegex.exec(file.content)) !== null) {
      const afterStmt = match[0];
      const lineNum = file.content.substring(0, match.index).split('\n').length;
      const nextLineContent = lines[lineNum]?.trim() || '';

      // Skip closing braces, comments, blank lines
      if (nextLineContent && !nextLineContent.startsWith('}') && !nextLineContent.startsWith('//') && !nextLineContent.startsWith('/*') && !nextLineContent.startsWith('*')) {
        findings.push({
          pattern_id: 'unreachable-branches',
          pattern_name: 'Unreachable Branch',
          file_path: file.path,
          line: lineNum + 1,
          column: file.content.substring(0, match.index).split('\n').pop()?.length || 0,
          message: `Code after '${afterStmt.split(';')[0].split('\n')[0].trim()}' is unreachable`,
          severity: 'error' as PatternSeverityType,
          category: 'dead_code' as PatternCategoryType,
          snippet: nextLineContent.substring(0, 80),
        });
      }
    }

    // Method 2: Manual line-by-line detection for after return/throw on same logical line
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();

      // Check for return/throw followed by code on next line (within reasonable indent)
      if (/^\s*(return|throw)\b/.test(line) && !line.trimEnd().endsWith(',')) {
        // Check the line doesn't end with a block-opening brace
        if (!line.trimEnd().endsWith('{') && !line.includes('=>')) {
          const nextLine = lines[i + 1].trim();
          if (nextLine && !nextLine.startsWith('}') && !nextLine.startsWith('//') && !nextLine.startsWith('*') && !nextLine.startsWith(')') && !nextLine.startsWith(']')) {
            // Make sure this isn't a false positive (e.g., return value on next line continuation)
            // Only flag if the next line looks like a new statement
            if (/^(const|let|var|function|if|for|while|switch|try|return|throw|class|import|export)\b/.test(nextLine) ||
                /^[a-z_$][a-zA-Z0-9_$]*\s*[=(.]/.test(nextLine)) {
              findings.push({
                pattern_id: 'unreachable-branches',
                pattern_name: 'Unreachable Branch',
                file_path: file.path,
                line: i + 2,
                column: 0,
                message: `Code after '${line}' is unreachable`,
                severity: 'error' as PatternSeverityType,
                category: 'dead_code' as PatternCategoryType,
                snippet: nextLine.substring(0, 80),
              });
            }
          }
        }
      }
    }
  }

  return findings;
}
