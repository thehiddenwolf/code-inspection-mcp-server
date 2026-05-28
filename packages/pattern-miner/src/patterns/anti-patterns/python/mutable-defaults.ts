import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

/**
 * Detect mutable default arguments in Python function definitions.
 * E.g., `def foo(l=[]):` or `def foo(d={}):`
 */
export async function detectMutableDefaults(
  files: { path: string; content: string }[],
): Promise<PatternMatchType[]> {
  const findings: PatternMatchType[] = [];

  // Match default arguments that are mutable
  // `param=[]`, `param={}`, `param=set()`
  const mutableDefaultRegex = /=\s*(\[\]|\{\}|set\(\))/g;

  for (const file of files) {
    if (!file.path.endsWith('.py')) continue;

    const lines = file.content.split('\n');

    // Track comment lines
    const commentLines = new Set<number>();
    let inMultilineString = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (inMultilineString) {
        if (line.includes("'''") || line.includes('"""')) inMultilineString = false;
        continue;
      }
      if ((line.includes("'''") || line.includes('"""')) &&
          ((line.match(/'''/g)?.length || 0) + (line.match(/"""/g)?.length || 0)) % 2 !== 0) {
        inMultilineString = true;
        continue;
      }
      if (line.trim().startsWith('#') || line.trim().startsWith('"""') || line.trim().startsWith("'''")) {
        commentLines.add(i);
      }
    }

    // Check each line for def statements with mutable defaults
    for (let i = 0; i < lines.length; i++) {
      if (commentLines.has(i)) continue;

      const line = lines[i].trim();

      // Only look inside function definitions
      if (!line.startsWith('def ')) continue;

      // Extract the signature part (between parentheses)
      const parenStart = line.indexOf('(');
      const parenEnd = line.lastIndexOf(')');
      if (parenStart === -1 || parenEnd === -1) continue;

      const signature = line.substring(parenStart, parenEnd + 1);

      mutableDefaultRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = mutableDefaultRegex.exec(signature)) !== null) {
        const defaultValue = match[1];
        const typeLabel = defaultValue === '[]' ? 'list' : defaultValue === '{}' ? 'dict' : 'set';

        // Find the parameter name
        const beforeDefault = signature.substring(0, match.index);
        const paramMatch = beforeDefault.match(/(\w+)\s*=\s*$/);
        const paramName = paramMatch ? paramMatch[1] : '(unknown)';

        findings.push({
          pattern_id: 'mutable-defaults',
          pattern_name: 'Mutable Default Argument',
          file_path: file.path,
          line: i + 1,
          column: match.index + parenStart,
          message: `Mutable default argument '${paramName}=${defaultValue}' — the ${typeLabel} is shared across all calls. Use None instead.`,
          severity: 'error' as PatternSeverityType,
          category: 'correctness' as PatternCategoryType,
          snippet: line.substring(0, 120),
        });
      }
    }

    // Handle multi-line defs (continued on next line)
    let pendingDef = false;
    let pendingLineNum = 0;
    let sigStart = '';
    for (let i = 0; i < lines.length; i++) {
      if (commentLines.has(i)) continue;
      const trimmed = lines[i].trim();

      if (pendingDef) {
        sigStart += ' ' + trimmed;
        if (trimmed.includes(')') && trimmed.includes(':')) {
          // Full signature collected
          mutableDefaultRegex.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = mutableDefaultRegex.exec(sigStart)) !== null) {
            const defaultValue = match[1];
            const typeLabel = defaultValue === '[]' ? 'list' : defaultValue === '{}' ? 'dict' : 'set';
            findings.push({
              pattern_id: 'mutable-defaults',
              pattern_name: 'Mutable Default Argument',
              file_path: file.path,
              line: pendingLineNum,
              column: match.index,
              message: `Mutable default argument with ${typeLabel} — shared mutable default across all calls`,
              severity: 'error' as PatternSeverityType,
              category: 'correctness' as PatternCategoryType,
              snippet: sigStart.substring(0, 120),
            });
          }
          pendingDef = false;
          sigStart = '';
        }
      }

      if (trimmed.startsWith('def ') && !trimmed.includes('):')) {
        pendingDef = true;
        pendingLineNum = i + 1;
        sigStart = trimmed;
      }
    }
  }

  return findings;
}
