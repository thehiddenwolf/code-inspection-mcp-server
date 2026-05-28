import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

/**
 * Detect bare `except:` clauses in Python files (no exception type specified).
 */
export async function detectBareExcept(
  files: { path: string; content: string }[],
): Promise<PatternMatchType[]> {
  const findings: PatternMatchType[] = [];

  // Pattern: bare "except:" on its own line, or "except :" with extra space
  const bareExceptRegex = /^\s*except\s*:/gm;
  const bareExceptSpaceRegex = /^\s*except\s+:/gm;

  for (const file of files) {
    if (!file.path.endsWith('.py')) continue;

    const lines = file.content.split('\n');
    let inMultilineString = false;

    // Track multi-line strings (triple-quoted strings)
    const skipLines = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (inMultilineString) {
        skipLines.add(i);
        if (line.includes("'''") || line.includes('"""')) {
          const counts = (line.match(/'''/g) || []).length + (line.match(/"""/g) || []).length;
          if (counts % 2 !== 0) inMultilineString = !inMultilineString;
        }
        continue;
      }
      if (line.includes("'''") || line.includes('"""')) {
        const tripleSingle = (line.match(/'''/g) || []).length;
        const tripleDouble = (line.match(/"""/g) || []).length;
        if ((tripleSingle + tripleDouble) % 2 !== 0) {
          inMultilineString = true;
          skipLines.add(i);
          continue;
        }
      }
      if (line.trim().startsWith('#')) {
        skipLines.add(i);
      }
    }

    // Reset regex state
    bareExceptRegex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = bareExceptRegex.exec(file.content)) !== null) {
      const lineNum = file.content.substring(0, match.index).split('\n').length - 1;
      if (skipLines.has(lineNum)) continue;

      const lineText = lines[lineNum];
      // Double-check it's really a bare except (not `except Exception as e:` etc.)
      if (/^\s*except\s+[^:]*:/.test(lineText)) continue;

      findings.push({
        pattern_id: 'bare-except',
        pattern_name: 'Bare Except Clause',
        file_path: file.path,
        line: lineNum + 1,
        column: lineText.search(/except/),
        message: `Bare 'except:' catches all exceptions, including SystemExit and KeyboardInterrupt — specify exception type(s)`,
        severity: 'error',
        category: 'best_practice',
        snippet: lineText.trim(),
      });
    }
  }

  return findings;
}
