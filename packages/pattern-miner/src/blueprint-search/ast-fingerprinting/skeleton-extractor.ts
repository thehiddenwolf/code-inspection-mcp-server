/**
 * AST skeleton extractor — produces structural skeletons from code.
 *
 * A "skeleton" is the code with variable names, literals, and identifiers
 * replaced with placeholders, preserving only the structural shape:
 * keywords, brackets, operators, control flow structure.
 *
 * This is engine #3 from the Blueprint Scout spec §2.2:
 * "AST fingerprinting — Custom hash-based signature matching
 *  for function/class skeletons."
 *
 * Since we don't have Tree-sitter wired into pattern-miner (it lives
 * in token-squeezer), we use a regex-based approach that captures
 * structural patterns well enough for MinHash fingerprinting.
 * For deeper AST extraction, the Context-Slasher skeleton output
 * can be fed directly into this engine.
 */

import type { AstFingerprint, SkeletonKind } from './types.js';

/**
 * Named capture groups for structural patterns we recognize.
 * Each pattern extracts a function/class/method skeleton.
 */
const STRUCTURAL_PATTERNS = [
  // Arrow functions: const foo = (...) => { ... }
  /(?:const|let|var)\s+\w+\s*=\s*(?:\([^)]*\)\s*=>\s*\{[\s\S]*?\n\})/g,

  // Named functions: function foo(...) { ... }
  /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g,

  // Async functions: async function foo(...) { ... }
  /async\s+function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g,

  // Methods in classes: foo(...) { ... } (indented)
  /^\s+(?:async\s+)?\w+\s*\([^)]*\)\s*\{[\s\S]*?\n\s+\}/gm,

  // Class declarations: class Foo { ... }
  /class\s+\w+\s*(?:extends\s+\w+\s*)?\{[\s\S]*?\n\}/g,

  // Class with implements: class Foo implements Bar { ... }
  /class\s+\w+\s+implements\s+\w+(?:\s*,\s*\w+)*\s*\{[\s\S]*?\n\}/g,
];

/**
 * Extract function/class skeletons from source code text.
 * Returns structural fingerprints ready for MinHash.
 */
export function extractSkeletons(
  code: string,
  filePath: string,
  offsetLine: number = 1,
): AstFingerprint[] {
  const fingerprints: AstFingerprint[] = [];

  for (const pattern of STRUCTURAL_PATTERNS) {
    let match: RegExpExecArray | null;
    // Reset lastIndex
    pattern.lastIndex = 0;

    while ((match = pattern.exec(code)) !== null) {
      const skeletonText = match[0];
      const startOffset = match.index;

      // Calculate line numbers from offset
      const beforeCode = code.slice(0, startOffset);
      const startLine = offsetLine + (beforeCode.match(/\n/g)?.length ?? 0);
      const endLine = startLine + (skeletonText.match(/\n/g)?.length ?? 0);

      // Determine the kind
      const kind = classifySkeleton(skeletonText);

      // Extract the label (function/class name)
      const label = extractLabel(skeletonText, kind);

      // Create the structural skeleton: strip names/literals
      const skeleton = createSkeleton(skeletonText);

      fingerprints.push({
        label,
        skeleton,
        signature: [], // Will be filled by the engine
        shingleCount: 0,
        filePath,
        startLine,
        endLine,
        kind,
      });
    }
  }

  return fingerprints;
}

/**
 * Classify what kind of skeleton we found.
 */
function classifySkeleton(text: string): SkeletonKind {
  // Check for arrow function (const foo = (...) => {)
  if (/=>\s*\{/.test(text)) return 'lambda';
  // Check for class
  if (/^class\s/.test(text)) return 'class';
  // Check for method (indented, inside a class context)
  if (/^\s+(?:async\s+)?\w+\s*\(/.test(text) && !/^\s*(?:const|let|var|function)/.test(text)) return 'method';
  // Default: function
  return 'function';
}

/**
 * Extract the human-readable label from a skeleton.
 */
function extractLabel(text: string, kind: SkeletonKind): string {
  switch (kind) {
    case 'function': {
      const m = text.match(/function\s+(\w+)/);
      return m ? m[1] : 'anonymous';
    }
    case 'class': {
      const m = text.match(/class\s+(\w+)/);
      return m ? m[1] : 'anonymous';
    }
    case 'lambda': {
      const m = text.match(/(?:const|let|var)\s+(\w+)\s*=/);
      return m ? m[1] : 'anonymous';
    }
    case 'method': {
      const m = text.match(/^\s*(?:async\s+)?(\w+)\s*\(/);
      return m ? m[1] : 'anonymous';
    }
  }
}

/**
 * Create a structural skeleton by replacing identifiers with placeholders.
 *
 * This strips:
 * - Variable names → $ID
 * - String/number literals → $LIT
 * - Function/method names → $FN
 * - Type annotations → $TYPE
 *
 * Preserves:
 * - Keywords (if, for, while, return, function, class, etc.)
 * - Operators (+, -, ===, =>, etc.)
 * - Brackets and braces ({, }, (, ), [, ])
 * - Semicolons, commas, colons
 */
export function createSkeleton(text: string): string {
  let skeleton = text;

  // 1. Replace type annotations (TypeScript)
  skeleton = skeleton.replace(/:\s*\w+(?:<[^>]+>)?(?:\[\])?/g, ':$TYPE');

  // 2. Replace string literals
  skeleton = skeleton.replace(/['"](?:[^'"]*)['"]/g, '$LIT');

  // 3. Replace template literals
  skeleton = skeleton.replace(/`(?:[^`]*)`/g, '$LIT');

  // 4. Replace numeric literals (including decimals, hex)
  skeleton = skeleton.replace(/\b\d+(?:\.\d+)?(?:n|L)?\b/g, '$NUM');

  // 5. Replace identifiers in calls: foo( → $FN(
  skeleton = skeleton.replace(/(\w+)\s*\(/g, (match, name) => {
    // Don't replace keywords
    const keywords = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'catch',
      'return', 'throw', 'typeof', 'instanceof', 'delete', 'void',
      'new', 'function', 'class', 'async', 'await', 'yield',
    ]);
    if (keywords.has(name)) return match;
    return '$FN(';
  });

  // 6. Replace remaining identifiers (variables, properties)
  //    But not keywords
  skeleton = skeleton.replace(/\b[a-zA-Z_$]\w*\b/g, (match) => {
    const keywords = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
      'continue', 'return', 'throw', 'try', 'catch', 'finally',
      'typeof', 'instanceof', 'delete', 'void', 'new', 'this',
      'function', 'class', 'extends', 'implements', 'interface',
      'const', 'let', 'var', 'import', 'export', 'from', 'default',
      'async', 'await', 'yield', 'of', 'in', 'as', 'is', 'satisfies',
      'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
    ]);
    if (keywords.has(match)) return match;
    // Already replaced calls
    if (match.startsWith('$')) return match;
    return '$ID';
  });

  // 7. Normalize whitespace: collapse multiple spaces
  skeleton = skeleton.replace(/[ \t]+/g, ' ');

  // 8. Remove leading/trailing whitespace per line
  skeleton = skeleton.replace(/^\s+/gm, '');

  return skeleton.trim();
}

/**
 * Convert a full source file into its structural fingerprints.
 * Extracts all functions, classes, methods, and lambdas,
 * then computes shingles and signatures for each.
 */
export function fingerprintFile(
  code: string,
  filePath: string,
): AstFingerprint[] {
  return extractSkeletons(code, filePath);
}

/**
 * Check if a skeleton is unique enough to be useful for matching.
 * Very short skeletons (< 3 lines or < 20 chars) are too generic.
 */
export function isMeaningfulSkeleton(skeleton: string): boolean {
  const lines = skeleton.split('\n').filter(l => l.trim().length > 0);
  return lines.length >= 3 && skeleton.length >= 50;
}
