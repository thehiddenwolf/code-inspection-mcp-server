import type { ViolationType } from '@hermes/shared/schemas/violations.js';
import { getLineNumber } from '../checker.js';
import { getEnforcerRules } from './utils.js';

/**
 * Check a class for Single Responsibility Principle violations.
 *
 * Heuristic: count distinct "concern areas" referenced by class methods.
 * If a class references >1 concern area, it likely violates SRP.
 */
export function checkSingleResponsibility(
  code: string,
  file: string,
  options?: { minConcernAreas?: number },
): ViolationType[] {
  const rules = getEnforcerRules(file);
  const violations: ViolationType[] = [];
  const minConcernAreas = options?.minConcernAreas ?? 2;

  // Find all class declarations
  const classRegex = new RegExp(rules.classRegex.source, rules.classRegex.flags.includes('g') ? rules.classRegex.flags : rules.classRegex.flags + 'g');
  let classMatch: RegExpExecArray | null;

  while ((classMatch = classRegex.exec(code)) !== null) {
    const className = classMatch[1];
    const classStart = classMatch.index;
    const classBody = extractClassBody(code, classStart);

    if (!classBody) continue;

    const concerns = detectConcerns(classBody, rules.concernPatterns);

    if (concerns.length >= minConcernAreas) {
      const line = getLineNumber(code, classStart);
      violations.push({
        rule_id: 'solid_srp',
        rule_name: 'Single Responsibility Principle',
        severity: 'warning',
        message: `Class '${className}' handles multiple concerns: ${concerns.join(', ')}. Consider splitting into separate classes for each concern.`,
        locations: [{
          file,
          line,
          column: 1,
          snippet: `class ${className} { ... }`,
        }],
        remediation: `Extract ${concerns.slice(1).join(' and ')} concerns into separate classes. Each class should have only one reason to change.`,
        category: 'solid_srp',
      });
    }
  }

  return violations;
}

/**
 * Extract the body content of a class starting at the opening brace.
 */
function extractClassBody(code: string, classStart: number): string | null {
  const braceStart = code.indexOf('{', classStart);
  if (braceStart === -1) return null;

  let depth = 0;
  let pos = braceStart;

  while (pos < code.length) {
    if (code[pos] === '{') depth++;
    if (code[pos] === '}') depth--;
    if (depth === 0) break;
    pos++;
  }

  return code.substring(braceStart + 1, pos);
}

/**
 * Detect which concern areas are present in the class body.
 * Skips matches that are clearly delegation calls on this.property (injected dependencies).
 * Skips lines that are type annotations in constructors (e.g., repository pattern names in DI).
 * Also skips lines that have `this.something.method()` before the match (delegation pattern).
 */
function detectConcerns(classBody: string, concernPatterns: Record<string, RegExp[]>): string[] {
  const found: string[] = [];

  for (const [concern, patterns] of Object.entries(concernPatterns)) {
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      while ((match = re.exec(classBody)) !== null) {
        const lineStart = classBody.lastIndexOf('\n', match.index) + 1;
        const lineEnd = classBody.indexOf('\n', match.index);
        const line = classBody.substring(lineStart, lineEnd === -1 ? classBody.length : lineEnd).trim();

        // Skip if the match is inside a constructor parameter type annotation
        // e.g., `private repo: IRepository<any>` — the type name is not an actual operation
        const lineBeforeMatch = line.substring(0, match.index - lineStart);
        if (/:\s*(?:I[A-Z]|Abstract|Readonly|Partial|Pick|Omit)/.test(lineBeforeMatch)) {
          continue;
        }

        // Skip type declarations (const/let/var with type annotations)
        if (/(?:private|public|protected|readonly)\s+\w+\s*:\s*\w/.test(line)) {
          continue;
        }

        // Skip delegation calls: if the line has `this.<identifier>.` BEFORE the match position
        const matchOffsetInLine = match.index - lineStart;
        const beforeMatch = line.substring(0, matchOffsetInLine).trim();
        const isDelegation = /this\.\w+\.\w+\s*\(/.test(line) &&
          !/^(?:this\.\w+\s*=\s*|return\s+this\.)/.test(beforeMatch);

        // Also skip if the entire line is just a delegation chain
        const isSimpleDelegationCall = /^(?:await\s+)?this\.\w+\./.test(line);

        if (isDelegation || isSimpleDelegationCall) {
          continue;
        }

        found.push(concern);
        break;
      }
      if (found.includes(concern)) break;
    }
  }

  return found;
}
