import type { ViolationType } from '@hermes/shared/schemas/violations.js';
import { getLineNumber } from '../checker.js';

/**
 * Check for Open/Closed Principle violations.
 *
 * Heuristic: detect large switch/if-else chains on a type discriminator
 * (>3 branches) that suggest modification-prone code.
 */
export function checkOpenClosed(
  code: string,
  file: string,
  options?: { maxSwitchBranches?: number },
): ViolationType[] {
  const violations: ViolationType[] = [];
  const maxBranches = options?.maxSwitchBranches ?? 3;

  // Check switch statements
  const switchRegex = /switch\s*\((\w+)\)\s*\{/g;
  let switchMatch: RegExpExecArray | null;

  while ((switchMatch = switchRegex.exec(code)) !== null) {
    const switchStart = switchMatch.index;
    const switchBody = extractSwitchBody(code, switchStart);
    if (!switchBody) continue;

    const caseCount = (switchBody.match(/\bcase\s+/g) || []).length;
    const hasDefault = /\bdefault\s*:/.test(switchBody);

    if (caseCount > maxBranches) {
      const line = getLineNumber(code, switchStart);
      const discriminator = switchMatch[1];
      violations.push({
        rule_id: 'solid_ocp',
        rule_name: 'Open/Closed Principle',
        severity: 'warning',
        message: `Switch statement on '${discriminator}' has ${caseCount} branches (max recommended: ${maxBranches}). This is modification-prone code that violates OCP.`,
        locations: [{
          file,
          line,
          column: 1,
          snippet: `switch (${discriminator}) { /* ${caseCount} cases */ }`,
        }],
        remediation: `Replace the switch statement with a strategy pattern or polymorphism. New behavior should be added by extending, not modifying existing code.${hasDefault ? ' Ensure the default case is handled.' : ''}`,
        category: 'solid_ocp',
      });
    }
  }

  // Check if-else chains that look like type discrimination
  const ifElseRegex = /if\s*\(.*(?:===|==)\s*['"`](.+?)['"`]\)/g;
  const ifElseLines: Map<number, { line: number; start: number }> = new Map();

  let ifMatch: RegExpExecArray | null;
  while ((ifMatch = ifElseRegex.exec(code)) !== null) {
    const line = getLineNumber(code, ifMatch.index);
    const key = line;
    ifElseLines.set(key, { line, start: ifMatch.index });
  }

  // Group consecutive if-else chains (within 3 lines of each other)
  const sortedLines = Array.from(ifElseLines.values()).sort((a, b) => a.line - b.line);
  let chainStart = 0;

  while (chainStart < sortedLines.length) {
    let chainEnd = chainStart;
    while (
      chainEnd + 1 < sortedLines.length &&
      sortedLines[chainEnd + 1].line - sortedLines[chainEnd].line <= 3
    ) {
      chainEnd++;
    }

    const chainLength = chainEnd - chainStart + 1;
    if (chainLength > maxBranches) {
      const firstLine = sortedLines[chainStart].line;
      violations.push({
        rule_id: 'solid_ocp',
        rule_name: 'Open/Closed Principle',
        severity: 'info',
        message: `Found an if-else chain with ${chainLength} branches on string/value comparisons. This may violate OCP — consider using a strategy pattern or polymorphism instead.`,
        locations: [{
          file,
          line: firstLine,
          column: 1,
          snippet: `if-else chain (${chainLength} branches starting at line ${firstLine})`,
        }],
        remediation: 'Replace the if-else chain with a strategy pattern, polymorphism, or a lookup table/map. New behavior should extend, not modify existing code.',
        category: 'solid_ocp',
      });
    }

    chainStart = chainEnd + 1;
  }

  // Check instanceof/typeof chains
  const typeCheckRegex = /(?:else\s+)?if\s*\(\s*(?:typeof\s+\w+\s*===?\s*['"`]|instanceof\b)/g;
  let typeMatch: RegExpExecArray | null;
  const typeLines: number[] = [];

  while ((typeMatch = typeCheckRegex.exec(code)) !== null) {
    typeLines.push(getLineNumber(code, typeMatch.index));
  }

  // If we see multiple type-checking ifs, group them
  if (typeLines.length > maxBranches) {
    const firstLine = typeLines[0];
    violations.push({
      rule_id: 'solid_ocp',
      rule_name: 'Open/Closed Principle',
      severity: 'info',
      message: `Found ${typeLines.length} typeof/instanceof checks in a chain. This type-discriminating code violates OCP — prefer polymorphism.`,
      locations: [{
        file,
        line: firstLine,
        column: 1,
        snippet: `typeof/instanceof chain (${typeLines.length} branches)`,
      }],
      remediation: 'Replace type-checking chains with polymorphic dispatch. Each type should implement a common interface method rather than being checked with typeof/instanceof.',
      category: 'solid_ocp',
    });
  }

  return violations;
}

/**
 * Extract the body of a switch statement.
 */
function extractSwitchBody(code: string, switchStart: number): string | null {
  const braceStart = code.indexOf('{', switchStart);
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
