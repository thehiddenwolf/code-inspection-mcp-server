import type { ViolationType } from '@hermes/shared/schemas/violations.js';
import { getLineNumber } from '../checker.js';

/**
 * Check for Liskov Substitution Principle violations.
 *
 * Heuristic: detect derived classes that:
 * 1. Throw NotImplementedError / Error('not implemented')
 * 2. Have empty method stubs (method body is only whitespace/comments)
 * 3. Methods that are clearly incompatible with base class contracts
 */
export function checkLiskovSubstitution(
  code: string,
  file: string,
): ViolationType[] {
  const violations: ViolationType[] = [];

  // ── 1. Find class declarations with 'extends' ──
  const classRegex = /class\s+(\w+)\s+extends\s+(\w+)(?:<[^>]*>)?\s*\{/g;
  let classMatch: RegExpExecArray | null;

  while ((classMatch = classRegex.exec(code)) !== null) {
    const derivedClass = classMatch[1];
    const baseClass = classMatch[2];
    const classStart = classMatch.index;
    const classBody = extractClassBody(code, classStart);

    if (!classBody) continue;

    // ── 2. Check for NotImplementedError throws ──
    // Matches both `throw new NotImplementedError(...)` and `throw new Error('not implemented'...)`
    const notImplRegex = /throw\s+(?:new\s+)?(?:NotImplementedError|Error)\s*\(\s*['"`][^'"`]*not\s+implemented[^'"`]*['"`]/gi;
    let notImplMatch: RegExpExecArray | null;

    while ((notImplMatch = notImplRegex.exec(classBody)) !== null) {
      const throwLine = getLineNumber(code, classStart + notImplMatch.index);

      // Find which method this throw is inside
      const methodName = findEnclosingMethod(classBody, notImplMatch.index);
      const methodHint = methodName ? ` in method '${methodName}'` : '';

      violations.push({
        rule_id: 'solid_lsp',
        rule_name: 'Liskov Substitution Principle',
        severity: 'error',
        message: `Derived class '${derivedClass}' (extends '${baseClass}') throws NotImplementedError${methodHint}. This breaks LSP — subtypes must be substitutable for their base types.`,
        locations: [{
          file,
          line: throwLine,
          column: 1,
          snippet: `throw new NotImplementedError(...)`,
        }],
        remediation: `Either implement the method properly in '${derivedClass}', or restructure the hierarchy. Consider using the Template Method pattern or making the base method abstract with a clear contract.`,
        category: 'solid_lsp',
      });
    }

    // ── 3. Check for empty method stubs ──
    const methodRegex = /(?:async\s+)?(\w+)\s*\([^)]*\)\s*:\s*\w+\s*\{/g;
    let methodMatch: RegExpExecArray | null;

    while ((methodMatch = methodRegex.exec(classBody)) !== null) {
      const methodBodyStart = classBody.indexOf('{', methodMatch.index);
      if (methodBodyStart === -1) continue;

      const methodBody = extractEnclosedBody(classBody, methodBodyStart);
      if (methodBody === null) continue;

      // Check if body is only whitespace, comments, or a single return/throw
      const stripped = methodBody
        .replace(/\/\/.*$/gm, '')   // remove line comments
        .replace(/\/\*[\s\S]*?\*\//g, '') // remove block comments
        .trim();

      if (stripped === '' || /^(?:return\s*;?\s*)?$/.test(stripped)) {
        const line = getLineNumber(code, classStart + methodMatch.index);
        violations.push({
          rule_id: 'solid_lsp',
          rule_name: 'Liskov Substitution Principle',
          severity: 'warning',
          message: `Method '${methodMatch[1]}' in derived class '${derivedClass}' is an empty stub. This may break LSP if callers expect real behavior.`,
          locations: [{
            file,
            line,
            column: 1,
            snippet: `${methodMatch[1]}(...) { /* empty */ }`,
          }],
          remediation: `Implement the method or mark it as abstract in the base class. Empty stubs violate the contract expected by callers.`,
          category: 'solid_lsp',
        });
      }
    }

    // ── 4. Check for methods that throw generic Error (not just NotImplemented) ──
    const genericThrowRegex = /throw\s+new\s+Error\s*\(/g;
    while ((genericThrowRegex.lastIndex = 0) || true) {
      const throwMatch = genericThrowRegex.exec(classBody);
      if (!throwMatch) break;

      const throwLine = getLineNumber(code, classStart + throwMatch.index);
      const methodName = findEnclosingMethod(classBody, throwMatch.index);

      if (methodName) {
        violations.push({
          rule_id: 'solid_lsp',
          rule_name: 'Liskov Substitution Principle',
          severity: 'warning',
          message: `Method '${methodName}' in '${derivedClass}' throws a generic Error. Derived methods should not throw exceptions that the base type's contract doesn't specify.`,
          locations: [{
            file,
            line: throwLine,
            column: 1,
            snippet: `throw new Error(...)`,
          }],
          remediation: `Replace with a specific exception type that conforms to the base class contract, or don't throw at all.`,
          category: 'solid_lsp',
        });
      }
      break; // only check first occurrence to avoid infinite loop edge case
    }
  }

  return violations;
}

/**
 * Extract the body of a class.
 */
function extractClassBody(code: string, classStart: number): string | null {
  const braceStart = code.indexOf('{', classStart);
  if (braceStart === -1) return null;

  return extractEnclosedBody(code, braceStart);
}

/**
 * Extract content inside a matching pair of braces.
 */
function extractEnclosedBody(code: string, braceStart: number): string | null {
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
 * Find which method name encloses a given position in a class body.
 */
function findEnclosingMethod(classBody: string, position: number): string | null {
  const methodRegex = /(\w+)\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{/g;
  let methodMatch: RegExpExecArray | null;

  while ((methodMatch = methodRegex.exec(classBody)) !== null) {
    const methodStart = methodMatch.index;
    const methodBodyEnd = findBodyEnd(classBody, classBody.indexOf('{', methodStart));

    if (methodBodyEnd !== null && position > methodStart && position < methodBodyEnd) {
      return methodMatch[1];
    }
  }

  return null;
}

/**
 * Find the end position of a brace-enclosed body.
 */
function findBodyEnd(code: string, braceStart: number): number | null {
  let depth = 0;
  let pos = braceStart;

  while (pos < code.length) {
    if (code[pos] === '{') depth++;
    if (code[pos] === '}') depth--;
    if (depth === 0) return pos;
    pos++;
  }

  return null;
}
