import type { ViolationType } from '@hermes/shared/schemas/violations.js';
import { getLineNumber } from '../checker.js';

/**
 * Check for Interface Segregation Principle violations.
 *
 * Heuristic: detect interfaces with many methods (>5) that force implementing
 * classes to throw NotImplementedError on some of them.
 */
export function checkInterfaceSegregation(
  code: string,
  file: string,
  options?: { minInterfaceMethods?: number },
): ViolationType[] {
  const violations: ViolationType[] = [];
  const minMethods = options?.minInterfaceMethods ?? 5;

  // ── 1. Find all interface declarations ──
  const interfaceRegex = /interface\s+(\w+)\s*(?:extends\s+[\w,\s]+)?\{/g;
  let interfaceMatch: RegExpExecArray | null;

  while ((interfaceMatch = interfaceRegex.exec(code)) !== null) {
    const interfaceName = interfaceMatch[1];
    const interfaceStart = interfaceMatch.index;
    const interfaceBody = extractBody(code, interfaceStart);

    if (!interfaceBody) continue;

    // Count method signatures in the interface
    const methodSigs = interfaceBody.match(/\w+\s*\([^)]*\)\s*:/g) || [];
    const methodCount = methodSigs.length;

    if (methodCount > minMethods) {
      const line = getLineNumber(code, interfaceStart);
      violations.push({
        rule_id: 'solid_isp',
        rule_name: 'Interface Segregation Principle',
        severity: 'warning',
        message: `Interface '${interfaceName}' has ${methodCount} methods (max recommended: ${minMethods}). Fat interfaces violate ISP — clients should not be forced to depend on methods they don't use.`,
        locations: [{
          file,
          line,
          column: 1,
          snippet: `interface ${interfaceName} { /* ${methodCount} methods */ }`,
        }],
        remediation: `Split '${interfaceName}' into smaller, more focused interfaces. Group related methods together so implementing classes only need to implement what they actually use.`,
        category: 'solid_isp',
      });
    }
  }

  // ── 2. Check classes implementing interfaces where some methods throw NotImplementedError ──
  const implRegex = /class\s+(\w+)\s+(?:implements\s+(\w+(?:\s*,\s*\w+)*))?/g;
  let implMatch: RegExpExecArray | null;

  while ((implMatch = implRegex.exec(code)) !== null) {
    const className = implMatch[1];
    if (!implMatch[2]) continue;

    const interfaces = implMatch[2].split(',').map(i => i.trim());
    const classStart = implMatch.index;
    const classBody = extractBody(code, classStart);

    if (!classBody) continue;

    const notImplRegex = /throw\s+(?:new\s+)?NotImplementedError\s*\([^)]*\)/gi;
    let notImplMatch: RegExpExecArray | null;
    const nonImplementedMethods: string[] = [];

    while ((notImplMatch = notImplRegex.exec(classBody)) !== null) {
      const methodName = findEnclosingMethod(classBody, notImplMatch.index);
      if (methodName) {
        nonImplementedMethods.push(methodName);
      }
    }

    if (nonImplementedMethods.length > 0) {
      const line = getLineNumber(code, classStart);
      violations.push({
        rule_id: 'solid_isp',
        rule_name: 'Interface Segregation Principle',
        severity: 'error',
        message: `Class '${className}' implements '${interfaces.join(', ')}' but leaves ${nonImplementedMethods.length} method(s) unimplemented (${nonImplementedMethods.join(', ')}). This indicates the interface(s) are too broad.`,
        locations: [{
          file,
          line,
          column: 1,
          snippet: `class ${className} implements ${interfaces.join(', ')} { ... }`,
        }],
        remediation: `Split the interface(s) so '${className}' only implements methods it actually needs. Extract the unimplemented methods (${nonImplementedMethods.join(', ')}) into separate, smaller interfaces.`,
        category: 'solid_isp',
      });
    }
  }

  // ── 3. Check for standalone type aliases with many function signatures ──
  const typeRegex = /type\s+(\w+)\s*=\s*\{/g;
  let typeMatch: RegExpExecArray | null;

  while ((typeMatch = typeRegex.exec(code)) !== null) {
    const typeName = typeMatch[1];
    const typeStart = typeMatch.index;
    const typeBody = extractBody(code, typeStart);

    if (!typeBody) continue;

    const methodSigs = typeBody.match(/\w+\s*\([^)]*\)\s*:/g) || [];
    const methodCount = methodSigs.length;

    if (methodCount > minMethods) {
      const line = getLineNumber(code, typeStart);
      violations.push({
        rule_id: 'solid_isp',
        rule_name: 'Interface Segregation Principle',
        severity: 'info',
        message: `Type alias '${typeName}' defines ${methodCount} method signatures. Consider splitting into smaller, focused types.`,
        locations: [{
          file,
          line,
          column: 1,
          snippet: `type ${typeName} = { /* ${methodCount} methods */ }`,
        }],
        remediation: `Split '${typeName}' into smaller type aliases, each representing a focused contract.`,
        category: 'solid_isp',
      });
    }
  }

  return violations;
}

/**
 * Extract body content between matching braces starting from a position.
 */
function extractBody(code: string, start: number): string | null {
  const braceStart = code.indexOf('{', start);
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
 * Find which method encloses a position in a class body.
 */
function findEnclosingMethod(classBody: string, position: number): string | null {
  const methodRegex = /(\w+)\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{/g;
  let methodMatch: RegExpExecArray | null;

  while ((methodMatch = methodRegex.exec(classBody)) !== null) {
    const methodStart = methodMatch.index;
    const bodyEnd = findBodyEnd(classBody, classBody.indexOf('{', methodStart));

    if (bodyEnd !== null && position > methodStart && position < bodyEnd) {
      return methodMatch[1];
    }
  }

  return null;
}

/**
 * Find the end of a brace-enclosed body.
 */
function findBodyEnd(code: string, braceStart: number): number | null {
  if (braceStart === -1) return null;
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
