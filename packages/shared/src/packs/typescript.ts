import type { LanguagePack } from '../types/language-pack.js';
import { posFromIndex } from './utils.js';

const JS_IMPORT_NAMED_RE = /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g;
const JS_IMPORT_DEFAULT_RE = /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
const JS_IMPORT_NS_RE = /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;

const JS_EXPORT_FUNCTION_RE = /export\s+(default\s+)?(?:async\s+)?function\s+(\w+)/g;
const JS_EXPORT_CLASS_RE = /export\s+(default\s+)?class\s+(\w+)/g;
const JS_EXPORT_INTERFACE_RE = /export\s+(default\s+)?interface\s+(\w+)/g;
const JS_EXPORT_VARIABLE_RE = /export\s+(default\s+)?(const|let|var)\s+(\w+)/g;
const JS_EXPORT_TYPE_RE = /export\s+type\s+(\w+)/g;
const JS_EXPORT_ENUM_RE = /export\s+(default\s+)?enum\s+(\w+)/g;

const JS_FUNCTION_DECL_RE = /(?:^|\n)\s*(?:async\s+)?function\s+(\w+)/g;
const JS_CLASS_DECL_RE = /(?:^|\n)\s*class\s+(\w+)/g;
const JS_INTERFACE_DECL_RE = /(?:^|\n)\s*interface\s+(\w+)/g;
const JS_TYPE_DECL_RE = /(?:^|\n)\s*type\s+(\w+)\s*=/g;
const JS_VARIABLE_DECL_RE = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(\w+)/g;

const JS_EXTENDS_RE = /(?:class|interface)\s+\w+\s+extends\s+(\w+)(?:<[^>]*>)?(?:,|\s*\{|\s+implements)/g;
const JS_IMPLEMENTS_RE = /class\s+\w+\s+(?:extends\s+\w+\s+)?implements\s+(\w+)/g;

const jsRepograph = {
  extractImports(content: string, filePath: string) {
    const results: any[] = [];
    const seen = new Set<string>();

    JS_IMPORT_NAMED_RE.lastIndex = 0;
    JS_IMPORT_DEFAULT_RE.lastIndex = 0;
    JS_IMPORT_NS_RE.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = JS_IMPORT_NAMED_RE.exec(content)) !== null) {
      const namesStr = match[1];
      const source = match[2];
      const names = namesStr.split(',').map((n) => {
        const parts = n.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim();
      });
      const key = `${source}:${names.join(',')}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ source, names });
      }
    }

    while ((match = JS_IMPORT_DEFAULT_RE.exec(content)) !== null) {
      const defaultName = match[1];
      const source = match[2];
      const key = `${source}:default`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ source, names: [defaultName], defaultName });
      }
    }

    while ((match = JS_IMPORT_NS_RE.exec(content)) !== null) {
      const ns = match[1];
      const source = match[2];
      const key = `${source}:*`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ source, names: [ns] });
      }
    }

    return results;
  },

  extractDeclarations(content: string, filePath: string) {
    const symbols: any[] = [];
    const lines = content.split('\n');
    const seen = new Set<string>();

    const patterns = [
      { re: JS_EXPORT_FUNCTION_RE, type: 'function' as const, exported: true, nameGroup: 2 },
      { re: JS_EXPORT_CLASS_RE, type: 'class' as const, exported: true, nameGroup: 2 },
      { re: JS_EXPORT_INTERFACE_RE, type: 'interface' as const, exported: true, nameGroup: 2 },
      { re: JS_EXPORT_VARIABLE_RE, type: 'variable' as const, exported: true, nameGroup: 3 },
      { re: JS_EXPORT_TYPE_RE, type: 'type' as const, exported: true, nameGroup: 1 },
      { re: JS_EXPORT_ENUM_RE, type: 'class' as const, exported: true, nameGroup: 2 },
      { re: JS_FUNCTION_DECL_RE, type: 'function' as const, exported: false, nameGroup: 1 },
      { re: JS_CLASS_DECL_RE, type: 'class' as const, exported: false, nameGroup: 1 },
      { re: JS_INTERFACE_DECL_RE, type: 'interface' as const, exported: false, nameGroup: 1 },
      { re: JS_TYPE_DECL_RE, type: 'type' as const, exported: false, nameGroup: 1 },
      { re: JS_VARIABLE_DECL_RE, type: 'variable' as const, exported: false, nameGroup: 1 },
    ];

    for (const pat of patterns) {
      pat.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.re.exec(content)) !== null) {
        const name = m[pat.nameGroup];
        if (seen.has(name)) continue;
        seen.add(name);
        const pos = posFromIndex(content, lines, m.index);
        symbols.push({
          name,
          type: pat.type,
          exported: pat.exported,
          line: pos.line,
          column: pos.column,
          filePath,
        });
      }
    }

    return symbols;
  },

  extractRelationships(content: string, filePath: string) {
    const edges: any[] = [];
    const seenEdges = new Set<string>();

    const addEdge = (fromId: string, toLabel: string, type: any) => {
      const key = `${fromId}:${toLabel}:${type}`;
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
      edges.push({
        from: fromId,
        to: `sym:${toLabel}`,
        type,
      });
    };

    JS_EXTENDS_RE.lastIndex = 0;
    JS_IMPLEMENTS_RE.lastIndex = 0;

    let m: RegExpExecArray | null;
    while ((m = JS_EXTENDS_RE.exec(content)) !== null) {
      const parentName = m[1];
      const before = content.slice(0, m.index);
      const classMatch = before.match(/(?:class|interface)\s+(\w+)\s+extends\s*$/m);
      if (classMatch) {
        addEdge(`sym:${classMatch[1]}@${filePath}`, parentName, 'extends');
      }
    }

    while ((m = JS_IMPLEMENTS_RE.exec(content)) !== null) {
      const ifaceName = m[1];
      const before = content.slice(0, m.index);
      const classMatch = before.match(/class\s+(\w+)/);
      if (classMatch) {
        addEdge(`sym:${classMatch[1]}@${filePath}`, ifaceName, 'implements');
      }
    }

    return edges;
  },
};

export const pack: LanguagePack = {
  metadata: {
    name: 'typescript',
    version: '1.0.0',
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'],
  },
  supportedLanguages: ['typescript', 'javascript', 'ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs', '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'],
  fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'],
  parserName: 'tree-sitter-typescript',
  repograph: jsRepograph,
  astQueries: {
    functions: `
      (function_declaration) @func
      (generator_function_declaration) @func
      (method_definition) @func
      (arrow_function) @func
      (function_expression) @func
    `,
    classes: `
      (class_declaration) @class
      (class_expression) @class
    `,
    imports: `
      (import_statement) @import
      (import_alias) @import
    `,
  },
  regexPatterns: {
    commentDetection: /\/\/.*|\/\*[\s\S]*?\*\//g,
    importExtraction: /^import\s+[\s\S]*?\s+from\s+['"].*?['"]/gm,
  },
  rules: {
    comment: { action: 'strip' },
    import: { action: 'shrink' },
  },
  squeezer: {
    bodyPlaceholder: '{ /* ... */ }',
    bodyPatterns: [
      {
        pattern: /(\b(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*(?:->\s*[^\n:]+)?\s*:)/g, // placeholder
        replacement: '$1\n    ...',
      },
      {
        pattern: /(\preview\s+)?\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*=>\s*\}\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g, // keep original pattern structure
        replacement: '$1{ /* ... */ }',
      },
      {
        pattern: /(\([^)]*\)\s*(?::\s*[^{]+)?\s*=>\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
      {
        pattern: /(function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
      {
        pattern: /(\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
      {
        pattern: /(class\s+\w+(?:<(?:[^>]+)>)?(?:\s+extends\s+\w+(?:<(?:[^>]+)>)?)?(?:\s+implements\s+\w+(?:,\s*\w+)*)?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
    ],
    privateBodyPatterns: [
      {
        pattern: /(?<!export\s+)(function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
      {
        pattern: /(?<!export\s+)(?:const|let|var)\s+\w+\s*=\s*(\([^)]*\)\s*(?::\s*[^{]+)?\s*=>\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
        replacement: '$1{ /* ... */ }',
      },
    ],
    importStartRegex: /^\s*(import|export)\s+/,
    importEndRegex: /\bfrom\s+['"].*?['"]|;$|\}.*\bfrom\b/,
    wildcardRules: [
      {
        pattern: /import\s+\{[\s\S]*?\}\s+from\s+(['"])(.+?)\1/,
        replacement: 'import * as $moduleName from \'$2\';',
        action: 'replace',
        sanitizeGroupIndex: 2,
      },
      {
        pattern: /import\s+\w+\s+from\s+(['"])(.+?)\1/,
        action: 'keep',
      },
    ],
    wildcardFallbackAction: 'remove',
  },
  lintFix: {
    commands: [
      ['npx', 'eslint', '--fix'],
      ['npx', 'prettier', '--write'],
    ],
  },
};

export default pack;
