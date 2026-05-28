import type { LanguagePack } from '@hermes/shared';

export const DEFAULT_PACKS: LanguagePack[] = [
  {
    metadata: {
      name: 'typescript',
      version: '1.0.0',
      fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'],
    },
    parserName: 'tree-sitter-typescript',
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
  },
  {
    metadata: {
      name: 'python',
      version: '1.0.0',
      fileExtensions: ['.py'],
    },
    parserName: 'tree-sitter-python',
    astQueries: {
      functions: `
        (function_definition) @func
      `,
      classes: `
        (class_definition) @class
      `,
      imports: `
        (import_statement) @import
        (import_from_statement) @import
      `,
    },
    regexPatterns: {
      commentDetection: /#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''/g,
      importExtraction: /^(?:import\s+\w+|from\s+\w+\s+import\s+[\w\s,()]+)/gm,
    },
    rules: {
      comment: { action: 'strip' },
      import: { action: 'shrink' },
    },
    squeezer: {
      bodyPlaceholder: '\n    ...',
      bodyPatterns: [
        {
          pattern: /^([ \t]*)((?:async\s+)?def\s+\w+\s*\([^)]*\)\s*(?:->\s*[^\n:]+)?\s*:)(?:\s*\n)(?:(?:\1[ \t]+[^\n]*\n?)|\s*\n)*/gm,
          replacement: '$1$2\n$1    ...',
        },
        {
          pattern: /^([ \t]*)(class\s+\w+(?:\([^)]*\))?\s*:)(?:\s*\n)(?:(?:\1[ \t]+[^\n]*\n?)|\s*\n)*/gm,
          replacement: '$1$2\n$1    ...',
        },
      ],
      privateBodyPatterns: [
        {
          pattern: /^([ \t]*)((?:async\s+)?def\s+_\w+\s*\([^)]*\)\s*(?:->\s*[^\n:]+)?\s*:)(?:\s*\n)(?:(?:\1[ \t]+[^\n]*\n?)|\s*\n)*/gm,
          replacement: '$1$2\n$1    ...',
        },
      ],
      importStartRegex: /^\s*(import|from)\s+/,
      importEndRegex: /\)/,
      wildcardRules: [
        {
          pattern: /from\s+(\S+)\s+import\s+/,
          replacement: 'import $1',
          action: 'replace',
        },
        {
          pattern: /import\s+(\w+),/,
          replacement: 'import $1',
          action: 'replace',
        },
      ],
      wildcardFallbackAction: 'keep',
    },
  },
  {
    metadata: {
      name: 'go',
      version: '1.0.0',
      fileExtensions: ['.go'],
    },
    parserName: 'tree-sitter-go',
    astQueries: {
      functions: `
        (function_declaration) @func
        (method_declaration) @func
      `,
      classes: `
        (type_declaration) @class
      `,
      imports: `
        (import_declaration) @import
      `,
    },
    regexPatterns: {
      commentDetection: /\/\/.*|\/\*[\s\S]*?\*\//g,
      importExtraction: /^import\s+(?:\([\s\S]*?\)|"[^"]*")/gm,
    },
    rules: {
      comment: { action: 'strip' },
      import: { action: 'shrink' },
    },
    squeezer: {
      bodyPlaceholder: '{ /* ... */ }',
      bodyPatterns: [
        {
          pattern: /(func\s+(?:\w+\s+)?\w+\s*\([^)]*\)\s*(?:\w+(?:<[^>]*>)?)?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
          replacement: '$1{ /* ... */ }',
        },
      ],
      privateBodyPatterns: [
        {
          pattern: /(func\s+[a-z]\w*\s*\([^)]*\)\s*(?:\w+(?:<[^>]*>)?)?\s*)\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}/g,
          replacement: '$1{ /* ... */ }',
        },
      ],
      importStartRegex: /^\s*import\s+/,
      importEndRegex: /\)/,
      wildcardFallbackAction: 'keep',
    },
  },
];
