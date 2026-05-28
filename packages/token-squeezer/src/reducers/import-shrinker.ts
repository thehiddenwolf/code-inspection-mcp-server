import type { AggressivenessLevel } from '@hermes/shared';
import { getLanguagePack } from '../utils.js';

export interface ShrinkResult {
  cleaned: string;
  removedCount: number;
}

export function shrinkImports(
  code: string,
  language: string,
  aggressiveness: AggressivenessLevel,
): ShrinkResult {
  switch (aggressiveness) {
    case 'conservative':
      return { cleaned: code, removedCount: 0 };
    case 'balanced':
      return shrinkBalanced(code, language);
    case 'aggressive':
      return shrinkAggressive(code, language);
  }
}

function getImportStartRegex(language: string): RegExp {
  const pack = getLanguagePack(language);
  if (pack?.squeezer?.importStartRegex) {
    return pack.squeezer.importStartRegex;
  }
  return /^\s*import\s+/;
}

function isEndOfMultilineImport(line: string, language: string): boolean {
  const pack = getLanguagePack(language);
  if (pack?.squeezer?.importEndRegex) {
    return pack.squeezer.importEndRegex.test(line);
  }
  const trimmed = line.trim();
  if (language === 'javascript' || language === 'typescript' || language === 'jsx' || language === 'tsx') {
    return /\bfrom\s+['"].*?['"]/.test(line) || trimmed.endsWith(';') || (trimmed.includes('}') && trimmed.includes('from'));
  }
  if (language === 'python' || language === 'go') {
    return trimmed.includes(')');
  }
  return trimmed.endsWith(';') || trimmed.endsWith(')');
}

interface GroupedCode {
  importLines: string[];
  nonImportLines: string[];
}

function groupImportsAndCode(code: string, language: string): GroupedCode {
  const importLines: string[] = [];
  const nonImportLines: string[] = [];

  const lines = code.split('\n');
  let inMultilineImport = false;
  const currentImportLines: string[] = [];

  const importStartRegex = getImportStartRegex(language);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inMultilineImport) {
      currentImportLines.push(line);
      if (isEndOfMultilineImport(line, language)) {
        inMultilineImport = false;
        importLines.push(currentImportLines.join('\n'));
        currentImportLines.length = 0;
      }
      continue;
    }

    if (importStartRegex.test(line)) {
      const pack = getLanguagePack(language);
      const isPyOrGo = pack?.metadata?.name === 'python' || pack?.metadata?.name === 'go' || language === 'python' || language === 'go';
      const isSingleLine = isPyOrGo
        ? (!line.includes('(') || line.includes(')'))
        : (line.includes('from') && (line.includes(';') || line.trimEnd().match(/['"]\s*;?\s*$/)));

      if (isSingleLine) {
        importLines.push(line);
      } else {
        inMultilineImport = true;
        currentImportLines.push(line);
      }
    } else {
      nonImportLines.push(line);
    }
  }

  if (currentImportLines.length > 0) {
    importLines.push(currentImportLines.join('\n'));
  }

  return { importLines, nonImportLines };
}

function shrinkBalanced(code: string, language: string): ShrinkResult {
  let removedCount = 0;
  const { importLines, nonImportLines } = groupImportsAndCode(code, language);

  // Extract identifiers from non-import code
  const usedIdentifiers = extractIdentifiers(nonImportLines.join('\n'));

  // Filter imports: keep only those whose identifiers are actually used
  const keptImports: string[] = [];
  for (const imp of importLines) {
    const importIdentifiers = extractImportIdentifiers(imp);
    if (importIdentifiers.length === 0) {
      // Default imports or side-effects — keep them
      keptImports.push(imp);
    } else if (importIdentifiers.some(id => usedIdentifiers.has(id))) {
      keptImports.push(imp);
    } else {
      removedCount++;
    }
  }

  return {
    cleaned: [...keptImports, ...nonImportLines].join('\n'),
    removedCount,
  };
}

function shrinkAggressive(code: string, language: string): ShrinkResult {
  const { importLines, nonImportLines } = groupImportsAndCode(code, language);
  const keptImports: string[] = [];
  let removedCount = 0;

  for (const imp of importLines) {
    const wildcard = tryWildcard(imp, language);
    if (wildcard) {
      keptImports.push(wildcard);
    } else {
      removedCount++;
    }
  }

  return {
    cleaned: [...keptImports, ...nonImportLines].join('\n'),
    removedCount,
  };
}

function tryWildcard(line: string, language: string): string | null {
  const pack = getLanguagePack(language);
  if (pack?.squeezer?.wildcardRules) {
    for (const rule of pack.squeezer.wildcardRules) {
      const match = line.match(rule.pattern);
      if (match) {
        if (rule.action === 'keep') {
          return line;
        }
        if (rule.action === 'remove') {
          return null;
        }
        if (rule.action === 'replace' && rule.replacement) {
          let replacement = rule.replacement;
          
          for (let i = match.length - 1; i >= 0; i--) {
            replacement = replacement.replaceAll(`$${i}`, match[i] || '');
          }
          
          if (rule.sanitizeGroupIndex !== undefined) {
            const rawIdentifier = match[rule.sanitizeGroupIndex] || '';
            let moduleName = rawIdentifier.replace(/[^a-zA-Z0-9_$]/g, '_');
            if (/^[0-9]/.test(moduleName)) {
              moduleName = '_' + moduleName;
            }
            replacement = replacement.replaceAll('$moduleName', moduleName);
          }
          
          return replacement;
        }
      }
    }
    const fallback = pack.squeezer.wildcardFallbackAction || 'keep';
    return fallback === 'keep' ? line : null;
  }

  if (language === 'javascript' || language === 'typescript' || language === 'jsx' || language === 'tsx') {
    const namedMatch = line.match(/import\s+\{[\s\S]*?\}\s+from\s+(['"])(.+?)\1/);
    if (namedMatch) {
      let moduleName = namedMatch[2].replace(/[^a-zA-Z0-9_$]/g, '_');
      if (/^[0-9]/.test(moduleName)) {
        moduleName = '_' + moduleName;
      }
      return `import * as ${moduleName} from '${namedMatch[2]}';`;
    }

    const defaultMatch = line.match(/import\s+\w+\s+from\s+(['"])(.+?)\1/);
    if (defaultMatch) return line;

    return null;
  }

  if (language === 'python') {
    const fromMatch = line.match(/from\s+(\S+)\s+import\s+/);
    if (fromMatch) {
      return `import ${fromMatch[1]}`;
    }

    const multiImport = line.match(/import\s+(\w+),/);
    if (multiImport) {
      return `import ${multiImport[1]}`;
    }

    return line;
  }

  return line;
}

function extractIdentifiers(code: string): Set<string> {
  const identifiers = new Set<string>();
  const regex = /\b([a-zA-Z_$][\w$]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(code)) !== null) {
    const keywords = new Set([
      'const', 'let', 'var', 'function', 'class', 'return', 'if', 'else',
      'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new',
      'this', 'super', 'typeof', 'instanceof', 'void', 'delete', 'try',
      'catch', 'finally', 'throw', 'async', 'await', 'yield', 'export',
      'import', 'from', 'of', 'in', 'as', 'true', 'false', 'null', 'undefined',
      'def', 'pass', 'elif', 'except', 'raise', 'with', 'lambda', 'nonlocal',
      'global', 'print', 'range', 'len', 'int', 'str', 'float', 'list', 'dict',
      'set', 'tuple', 'bool', 'None', 'True', 'False', 'and', 'or', 'not',
      'is', 'assert', 'self', 'cls',
    ]);
    if (!keywords.has(m[1]) && !/^\d/.test(m[1])) {
      identifiers.add(m[1]);
    }
  }
  return identifiers;
}

function extractImportIdentifiers(importStmt: string): string[] {
  const identifiers: string[] = [];

  // Remove type-only import specifiers
  const cleanedStmt = importStmt.replace(/\bimport\s+type\b/, 'import');

  // Named imports: import { foo, bar as baz } from ...
  const namedMatch = cleanedStmt.match(/\{\s*([^}]+)\s*\}/);
  if (namedMatch) {
    const parts = namedMatch[1].split(',');
    for (const part of parts) {
      let trimmed = part.trim();
      if (trimmed.startsWith('type ')) {
        trimmed = trimmed.substring(5).trim();
      }
      const asMatch = trimmed.match(/(\w+)\s+as\s+\w+/);
      if (asMatch) {
        identifiers.push(asMatch[1]);
        identifiers.push(trimmed.split(/\s+as\s+/)[1]);
      } else if (trimmed) {
        identifiers.push(trimmed);
      }
    }
  }

  // Default import
  const defaultMatch = cleanedStmt.match(/import\s+([a-zA-Z_$][\w$]*)\s*(?:,|\s+from)/);
  if (defaultMatch) {
    identifiers.push(defaultMatch[1]);
  }

  // Python: from module import Foo, Bar (with aliases)
  const pyMatch = cleanedStmt.match(/from\s+\S+\s+import\s+(.+)/);
  if (pyMatch) {
    const parts = pyMatch[1].split(',');
    for (const part of parts) {
      const trimmed = part.trim().split(/\s+as\s+/);
      identifiers.push(trimmed[0].trim());
      if (trimmed[1]) identifiers.push(trimmed[1].trim());
    }
  }

  // Python: import module, module2 as alias (handles multiple imports, aliases, subpackages)
  if (cleanedStmt.trim().startsWith('import ')) {
    if (!cleanedStmt.includes(' from ') && !cleanedStmt.includes('{') && !cleanedStmt.includes('(')) {
      const parts = cleanedStmt.replace(/^import\s+/, '').split(',');
      for (const part of parts) {
        const trimmed = part.trim().split(/\s+as\s+/);
        if (trimmed[1]) {
          identifiers.push(trimmed[1].trim());
        } else {
          identifiers.push(trimmed[0].trim().split('.')[0]);
        }
      }
    }
  }

  return identifiers;
}
