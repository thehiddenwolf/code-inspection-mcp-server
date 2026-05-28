import type { ViolationType } from '@hermes/shared/schemas/violations.js';
import { getLineNumber } from '../checker.js';

/**
 * Patterns that match value objects / DTOs / simple data classes.
 * Instantiating these inside a class is usually fine (doesn't violate DIP).
 */
const VALUE_OBJECT_PATTERNS = [
  /^[A-Z]\w*(?:Dto|DTO|ValueObject|Vo|VO|Data|Record|Model|Entity|Event|Message|Request|Response|Result|Error|Config|Options|Settings|Props|State|Input|Output)$/,
  /^(?:string|number|boolean|Date|RegExp|Map|Set|Array|Object|Promise|Error)$/,
];

/**
 * Default patterns that look like value objects.
 */
function isValueObject(className: string): boolean {
  return VALUE_OBJECT_PATTERNS.some(p => p.test(className));
}

/**
 * Check for Dependency Inversion Principle violations.
 *
 * Heuristic: detect:
 * 1. `new ConcreteClassName()` calls inside class methods (flag unless value object)
 * 2. Static method calls on concrete classes
 * 3. Absence of constructor injection pattern
 */
export function checkDependencyInversion(
  code: string,
  file: string,
  options?: { valueObjectPatterns?: RegExp[] },
): ViolationType[] {
  const violations: ViolationType[] = [];
  const valuePatterns = options?.valueObjectPatterns ?? VALUE_OBJECT_PATTERNS;

  // ── 1. Find class declarations ──
  const classRegex = /class\s+(\w+)/g;
  let classMatch: RegExpExecArray | null;

  while ((classMatch = classRegex.exec(code)) !== null) {
    const className = classMatch[1];
    const classStart = classMatch.index;
    const classBody = extractClassBody(code, classStart);

    if (!classBody) continue;

    const line = getLineNumber(code, classStart);

    // ── 2. Check for `new ConcreteClass()` inside methods ──
    const newRegex = /new\s+([A-Z]\w+)\s*\(/g;
    let newMatch: RegExpExecArray | null;

    while ((newMatch = newRegex.exec(classBody)) !== null) {
      const concreteClassName = newMatch[1];

      // Skip if it looks like a value object / DTO
      if (isValueObject(concreteClassName)) continue;
      // Skip common built-ins
      if (['Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Date', 'RegExp', 'Error', 'Array', 'Object'].includes(concreteClassName)) continue;

      const newLine = getLineNumber(code, classStart + newMatch.index);

      violations.push({
        rule_id: 'solid_dip',
        rule_name: 'Dependency Inversion Principle',
        severity: 'warning',
        message: `Class '${className}' directly instantiates '${concreteClassName}' with 'new'. This creates a hard dependency on a concrete implementation, violating DIP.`,
        locations: [{
          file,
          line: newLine,
          column: 1,
          snippet: `new ${concreteClassName}(...)`,
        }],
        remediation: `Inject '${concreteClassName}' through the constructor or a setter method. Depend on abstractions (interfaces), not concrete implementations.`,
        category: 'solid_dip',
      });
    }

    // ── 3. Check for static method calls on concrete classes ──
    const staticCallRegex = /([A-Z]\w+)\.(\w+)\s*\(/g;
    let staticMatch: RegExpExecArray | null;

    while ((staticMatch = staticCallRegex.exec(classBody)) !== null) {
      const staticClassName = staticMatch[1];

      // Skip common utility/static-only classes
      if (['JSON', 'Math', 'console', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'Promise', 'RegExp'].includes(staticClassName)) continue;
      if (staticClassName === className) continue; // own static methods

      const staticLine = getLineNumber(code, classStart + staticMatch.index);

      violations.push({
        rule_id: 'solid_dip',
        rule_name: 'Dependency Inversion Principle',
        severity: 'info',
        message: `Class '${className}' calls static method '${staticClassName}.${staticMatch[2]}()'. Static calls create tight coupling to concrete classes, violating DIP.`,
        locations: [{
          file,
          line: staticLine,
          column: 1,
          snippet: `${staticClassName}.${staticMatch[2]}()`,
        }],
        remediation: `Inject an abstraction that provides the '${staticMatch[2]}' functionality, rather than calling a static method on '${staticClassName}'.`,
        category: 'solid_dip',
      });
    }

    // ── 4. Check for absence of constructor injection ──
    // If the class has `new Xxx()` calls but no constructor parameters typed as interfaces
    const hasConcreteInstantiations = classBody.match(/new\s+[A-Z]\w+\s*\(/) !== null;
    if (hasConcreteInstantiations) {
      const constructorMatch = classBody.match(/constructor\s*\(([^)]*)\)/);
      if (constructorMatch) {
        const params = constructorMatch[1];
        // Check if at least one param looks like an interface (no `new` used, typed with interface-like name)
        const hasInterfaceParam = /:\s*I[A-Z]\w*/.test(params) || /:\s*[A-Z]\w*(?:Interface|Abstract|Service|Repository|Factory|Provider|Adapter|Port|Gateway)/.test(params);
        if (!hasInterfaceParam) {
          violations.push({
            rule_id: 'solid_dip',
            rule_name: 'Dependency Inversion Principle',
            severity: 'info',
            message: `Class '${className}' instantiates concrete dependencies directly but its constructor parameters don't appear to use interface/abstract types. Consider using constructor injection with abstractions.`,
            locations: [{
              file,
              line,
              column: 1,
              snippet: `class ${className} { constructor(${params}) { ... } }`,
            }],
            remediation: `Refactor '${className}' to receive its dependencies via constructor injection, typed as interfaces or abstract classes rather than concrete implementations.`,
            category: 'solid_dip',
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Extract class body between braces.
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
