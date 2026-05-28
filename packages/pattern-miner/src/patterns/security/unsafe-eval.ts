import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

/**
 * Detect unsafe code execution: eval(), Function(), exec(), setTimeout/setInterval with string input.
 */
export async function detectUnsafeEval(
  files: { path: string; content: string }[],
): Promise<PatternMatchType[]> {
  const findings: PatternMatchType[] = [];

  // Patterns for various unsafe eval-like constructs
  const unsafePatterns: { regex: RegExp; label: string }[] = [
    // Direct eval
    { regex: /\beval\s*\(/g, label: 'eval()' },

    // Function constructor
    { regex: /\bnew\s+Function\s*\(/g, label: 'new Function()' },

    // setTimeout/setInterval with string (not function)
    { regex: /(?:setTimeout|setInterval)\s*\(\s*['"`]/g, label: 'setTimeout/setInterval with string' },

    // Python exec
    { regex: /\bexec\s*\(/g, label: 'exec()' },

    // Python eval
    { regex: /\beval\s*\(/g, label: 'eval()' },

    // Dynamic require
    { regex: /\brequire\s*\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\)/g, label: 'Dynamic require()' },

    // vm.runInThisContext / vm.runInNewContext (Node.js)
    { regex: /\b(?:runInThisContext|runInNewContext|runInContext)\s*\(/g, label: 'Node.js vm execution' },

    // WebAssembly.compile with user input is harder to detect; skip for now
  ];

  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py)$/.test(file.path)) continue;

    const lines = file.content.split('\n');
    let inBlockComment = false;

    // Track comment lines
    const commentLines = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (inBlockComment) {
        commentLines.add(i);
        if (line.includes('*/')) inBlockComment = false;
        continue;
      }
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) {
        commentLines.add(i);
        continue;
      }
      const blockStart = line.indexOf('/*');
      if (blockStart !== -1) {
        commentLines.add(i);
        if (!line.includes('*/', blockStart + 2)) inBlockComment = true;
      }
    }

    for (const { regex, label } of unsafePatterns) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(file.content)) !== null) {
        const lineNum = file.content.substring(0, match.index).split('\n').length - 1;

        // Skip if the match is in a comment
        if (commentLines.has(lineNum)) continue;

        const lineText = lines[lineNum]?.trim() || '';
        const context = lineText.substring(0, 120);

        // Skip property accesses like `module.eval` or `obj.eval`
        const beforeMatch = file.content.substring(Math.max(0, match.index - 20), match.index);
        if (/\.\s*$/.test(beforeMatch)) continue;

        // For Python, also check that the file is actually .py
        if (file.path.endsWith('.py') && (label.includes('setTimeout') || label.includes('Function('))) continue;
        if (!file.path.endsWith('.py') && (label === 'exec()')) continue; // Python exec, not JS

        findings.push({
          pattern_id: 'unsafe-eval',
          pattern_name: 'Unsafe Eval / Dynamic Code Execution',
          file_path: file.path,
          line: lineNum + 1,
          column: match.index,
          message: `Usage of '${label}' allows arbitrary code execution — avoid or sandbox`,
          severity: 'critical',
          category: 'security',
          snippet: context,
        });
      }
    }
  }

  return findings;
}
