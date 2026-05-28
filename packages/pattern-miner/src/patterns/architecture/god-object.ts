import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

const MAX_METHODS = 20;

/**
 * Detect God Object anti-pattern — classes with too many methods.
 * Indicates a class that has too many responsibilities.
 */
export async function detectGodObject(
  files: { path: string; content: string }[],
  maxMethods: number = MAX_METHODS,
): Promise<PatternMatchType[]> {
  const findings: PatternMatchType[] = [];

  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|java|kt)$/.test(file.path)) continue;

    const lines = file.content.split('\n');
    let inBlockComment = false;

    // Find class definitions
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip comments
      if (inBlockComment) {
        if (line.includes('*/')) inBlockComment = false;
        continue;
      }
      if (line.startsWith('//') || line.startsWith('/*')) {
        if (line.startsWith('/*') && !line.includes('*/')) inBlockComment = true;
        continue;
      }

      // Match class declarations
      const classMatch = line.match(
        /^(?:export\s+)?(?:abstract\s+)?(?:default\s+)?class\s+(\w+)/,
      );
      if (!classMatch) continue;

      const className = classMatch[1];
      let braceDepth = 0;
      let methodCount = 0;
      let j = i;

      // Find the opening brace
      while (j < lines.length && !lines[j].includes('{')) j++;
      if (j >= lines.length) continue;

      braceDepth = 1;
      j++;

      // Walk through the class body counting methods
      while (j < lines.length && braceDepth > 0) {
        const bodyLine = lines[j].trim();

        // Track braces
        for (const ch of bodyLine) {
          if (ch === '{') braceDepth++;
          if (ch === '}') braceDepth--;
        }

        // Count method definitions at the class level (depth === 1)
        if (braceDepth === 1 && !bodyLine.startsWith('//') && !bodyLine.startsWith('*')) {
          // Method patterns for TS/JS
          const jsMethodRegex = /^(?:public|private|protected|static|async|get|set|readonly\s+)?\s*(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?(\w+)\s*\(/;

          // Method patterns for Python
          const pyMethodRegex = /^(?:async\s+)?def\s+(\w+)\s*\(/;

          // Method patterns for Java/Kotlin
          const javaMethodRegex = /(?:public|private|protected|static|final|synchronized|abstract)\s+(?:\w+[<>]?\s+)?(\w+)\s*\(/;

          if (jsMethodRegex.test(bodyLine) || pyMethodRegex.test(bodyLine) || javaMethodRegex.test(bodyLine)) {
            // Skip constructor if it's a method
            const methodName = bodyLine.match(/(?:def\s+|function\s+)?(\w+)\s*\(/);
            if (methodName && methodName[1] !== '__init__' && methodName[1] !== 'constructor') {
              methodCount++;
            }
          }

          // Also count arrow function assignments as methods
          if (/^\s*(?:public|private|protected|static)?\s*\w+\s*=\s*(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/.test(bodyLine)) {
            methodCount++;
          }
        }

        j++;
      }

      if (methodCount > maxMethods) {
        findings.push({
          pattern_id: 'god-object',
          pattern_name: 'God Object',
          file_path: file.path,
          line: i + 1,
          column: 0,
          message: `Class '${className}' has ${methodCount} methods — exceeds max ${maxMethods}. Consider splitting into smaller focused classes.`,
          severity: 'warning' as PatternSeverityType,
          category: 'architecture' as PatternCategoryType,
          snippet: `class ${className} { /* ${methodCount} methods */ }`,
        });
      }
    }
  }

  return findings;
}
