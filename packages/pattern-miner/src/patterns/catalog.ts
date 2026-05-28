import type { PatternDefinitionType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

export type PatternDetector = (
  files: { path: string; content: string }[],
) => Promise<import('@hermes/shared/schemas/patterns.js').PatternMatchType[]>;

export interface CatalogEntry {
  definition: PatternDefinitionType;
  detector: PatternDetector;
}

/**
 * The complete pattern registry — all built-in patterns with their
 * definitions and detection functions.
 */
const catalog: CatalogEntry[] = [


  // ── Anti-patterns (JS/TS) ──────────────────────────────
  {
    definition: {
      id: 'any-usage',
      name: 'Any Type Usage',
      description: 'Detects usage of `any` type annotations in TypeScript. Overuse of `any` defeats the purpose of TypeScript type checking.',
      category: 'best_practice',
      severity: 'warning',
      languages: ['typescript'],
      pattern: 'variable: any',
      message_template: "TypeScript 'any' type used — consider a more specific type",
      remediation: 'Replace `any` with a specific type, interface, or `unknown` with proper type narrowing.',
      examples: [
        { before: 'function process(data: any) { ... }', after: 'function process<T>(data: T) { ... }', description: 'Use generics instead of any' },
      ],
    },
    detector: async (files) => {
      const mod = await import('./anti-patterns/js-ts/any-usage.js');
      return mod.detectAnyUsage(files);
    },
  },

  {
    definition: {
      id: 'magic-numbers',
      name: 'Magic Number',
      description: 'Detects numeric literals used directly in code without being assigned to a named constant. Magic numbers reduce readability and maintainability.',
      category: 'style',
      severity: 'info',
      languages: ['typescript', 'javascript'],
      pattern: '<number>  // not assigned to a named constant',
      message_template: "Magic number '${value}' detected — assign to a named constant",
      remediation: 'Assign the number to a descriptively named constant (e.g., const MAX_RETRIES = 3).',
      examples: [
        { before: 'if (x > 86400) { ... }', after: 'const ONE_DAY_SECONDS = 86400;\nif (x > ONE_DAY_SECONDS) { ... }', description: 'Name the magic number' },
      ],
    },
    detector: async (files) => {
      const mod = await import('./anti-patterns/js-ts/magic-numbers.js');
      return mod.detectMagicNumbers(files);
    },
  },

  {
    definition: {
      id: 'nested-callbacks',
      name: 'Nested Callbacks',
      description: 'Detects deeply nested callback functions (callback hell) exceeding a configurable depth threshold (default: 3). Deep nesting harms readability.',
      category: 'complexity',
      severity: 'warning',
      languages: ['typescript', 'javascript'],
      pattern: 'asyncFunc1(() => { asyncFunc2(() => { asyncFunc3(() => { ... }) }) })',
      message_template: 'Callback nesting depth of ${depth} exceeds max ${maxDepth} — consider refactoring with async/await or Promises',
      remediation: 'Refactor nested callbacks into Promise chains or async/await syntax.',
      examples: [
        { before: 'fs.readFile("a", () => { fs.readFile("b", () => { ... }) })', after: 'const a = await readFile("a");\nconst b = await readFile("b");', description: 'Convert to async/await' },
      ],
    },
    detector: async (files) => {
      const mod = await import('./anti-patterns/js-ts/nested-callbacks.js');
      return mod.detectNestedCallbacks(files);
    },
  },

  // ── Anti-patterns (Python) ────────────────────────────
  {
    definition: {
      id: 'bare-except',
      name: 'Bare Except Clause',
      description: 'Detects bare `except:` clauses that catch ALL exceptions, including SystemExit and KeyboardInterrupt. This is a Python anti-pattern.',
      category: 'best_practice',
      severity: 'error',
      languages: ['python'],
      pattern: 'except:  # catches everything',
      message_template: "Bare 'except:' catches all exceptions — specify exception type(s)",
      remediation: 'Replace with `except SpecificException:` or at minimum `except Exception:` to avoid catching system-exiting exceptions.',
      examples: [
        { before: 'try: ...\nexcept:\n    pass', after: 'try: ...\nexcept ValueError:\n    pass', description: 'Specify exception type' },
      ],
    },
    detector: async (files) => {
      const mod = await import('./anti-patterns/python/bare-except.js');
      return mod.detectBareExcept(files);
    },
  },

  {
    definition: {
      id: 'mutable-defaults',
      name: 'Mutable Default Argument',
      description: 'Detects mutable default arguments in Python function definitions (e.g., `def foo(l=[]):`). Mutable defaults are shared across all calls.',
      category: 'correctness',
      severity: 'error',
      languages: ['python'],
      pattern: 'def func(param=[]):  # mutable default',
      message_template: 'Mutable default argument detected — shared across all calls; use None instead',
      remediation: 'Replace mutable default with `None` and initialize inside the function body.',
      examples: [
        { before: 'def add(item, lst=[]):\n    lst.append(item)\n    return lst', after: 'def add(item, lst=None):\n    if lst is None: lst = []\n    lst.append(item)\n    return lst', description: 'Use None sentinel pattern' },
      ],
    },
    detector: async (files) => {
      const mod = await import('./anti-patterns/python/mutable-defaults.js');
      return mod.detectMutableDefaults(files);
    },
  },

  // ── Architecture ──────────────────────────────────────
  {
    definition: {
      id: 'circular-deps',
      name: 'Circular Dependency',
      description: 'Detects circular import/dependency chains between modules. Circular dependencies cause tight coupling and can lead to runtime errors.',
      category: 'architecture',
      severity: 'error',
      languages: ['typescript', 'javascript', 'python'],
      pattern: 'A imports B → B imports C → C imports A',
      message_template: 'Circular dependency detected: ${cycle}',
      remediation: 'Extract the shared dependency into a separate module, or use dependency injection to break the cycle.',
      examples: [
        { before: '// a.ts imports b.ts, b.ts imports a.ts', after: '// a.ts imports types.ts, b.ts imports types.ts', description: 'Extract shared types' },
      ],
    },
    detector: async (files) => {
      const mod = await import('./architecture/circular-deps.js');
      return mod.detectCircularDeps(files);
    },
  },

  {
    definition: {
      id: 'god-object',
      name: 'God Object',
      description: 'Detects classes with too many methods (configurable threshold, default: 20). God objects violate the Single Responsibility Principle.',
      category: 'architecture',
      severity: 'warning',
      languages: ['typescript', 'javascript', 'python', 'java'],
      pattern: 'class LargeClass { method1() ... methodN() }',
      message_template: "Class '${name}' has ${count} methods — exceeds max ${max}. Consider splitting into smaller focused classes.",
      remediation: 'Decompose the class into smaller, single-responsibility classes using patterns like Facade or Strategy.',
      examples: [
        { before: 'class GodManager { createUser(); sendEmail(); generateReport(); ... }', after: 'class UserService { createUser(); }\nclass EmailService { sendEmail(); }\nclass ReportService { generateReport(); }', description: 'Split into focused services' },
      ],
    },
    detector: async (files) => {
      const mod = await import('./architecture/god-object.js');
      return mod.detectGodObject(files);
    },
  },

  // ── Security ──────────────────────────────────────────
  {
    definition: {
      id: 'hardcoded-secrets',
      name: 'Hardcoded Secret',
      description: 'Detects hardcoded credentials including API keys, passwords, tokens, connection strings, and private keys. These are a critical security risk.',
      category: 'security',
      severity: 'critical',
      languages: ['typescript', 'javascript', 'python', 'java', 'go', 'ruby', 'rust'],
      pattern: 'api_key = "sk-..."  # or similar credential patterns',
      message_template: 'Hardcoded ${type} detected — store in environment variables or a vault',
      remediation: 'Move secrets to environment variables, a secrets manager (e.g., Vault), or use a .env file (gitignored).',
      examples: [
        { before: 'const API_KEY = "sk-abc123def456"', after: 'const API_KEY = process.env.API_KEY', description: 'Use environment variables' },
      ],
    },
    detector: async (files) => {
      const mod = await import('./security/hardcoded-secrets.js');
      return mod.detectHardcodedSecrets(files);
    },
  },

  {
    definition: {
      id: 'unsafe-eval',
      name: 'Unsafe Eval / Dynamic Code Execution',
      description: 'Detects usage of eval(), new Function(), exec(), and other dynamic code execution APIs. These allow arbitrary code execution and are a security vulnerability.',
      category: 'security',
      severity: 'critical',
      languages: ['typescript', 'javascript', 'python'],
      pattern: 'eval(userInput)  // or similar dynamic execution',
      message_template: "Usage of '${construct}' allows arbitrary code execution — avoid or sandbox",
      remediation: 'Replace with safer alternatives: JSON.parse() for JSON, new Function() with restricted scope, or use a proper expression parser library.',
      examples: [
        { before: 'const result = eval(code);', after: 'const result = JSON.parse(json);', description: 'Use JSON.parse instead of eval' },
      ],
    },
    detector: async (files) => {
      const mod = await import('./security/unsafe-eval.js');
      return mod.detectUnsafeEval(files);
    },
  },

  // ── Duplication (CPD) ───────────────────────────────────
  {
    definition: {
      id: 'cpd-clones',
      name: 'Code Clone (CPD)',
      description: 'Detects token-level code clones using PMD CPD\'s algorithm. Uses Rabin-Karp rolling hash over normalized token streams to find duplicated code blocks across files. Normalizes identifier names and literals to detect renamed variables.',
      category: 'duplication',
      severity: 'warning',
      languages: ['typescript', 'javascript', 'python'],
      pattern: 'tokenized analysis — finds structurally identical code blocks',
      message_template: 'Clone of ${target_file}:${target_lines} (${token_count} tokens)',
      remediation: 'Extract the duplicated code into a shared function, module, or utility. If the duplication is intentional (e.g., test fixtures), consider documenting it as such.',
      examples: [
        { before: '// fileA.ts and fileB.ts have identical 50-line functions', after: '// Extract to shared/utils.ts and import in both places', description: 'Extract shared code' },
      ],
    },
    detector: async (files) => {
      const mod = await import('./duplication/cpd-clones.js');
      return mod.detectCodeClones(files);
    },
  },

  // ── Duplication (Structural — AST Fingerprinting) ─────────
  {
    definition: {
      id: 'structural-clones',
      name: 'Structural Code Clone (AST Fingerprinting)',
      description: 'Detects structural code clones using AST fingerprinting with MinHash/LSH. Extracts structural skeletons (function/class shapes with names and literals stripped), computes MinHash signatures, and finds cross-file clones via LSH indexing. Detects Type-2 clones that Semgrep and CPD may miss.',
      category: 'duplication',
      severity: 'warning',
      languages: ['typescript', 'javascript', 'python'],
      pattern: 'AST skeleton matching — finds Type-2 structural clones with renamed identifiers',
      message_template: 'Structural clone of ${source}:${source_lines} (similarity: ${similarity})',
      remediation: 'Extract the duplicated structure into a shared function, module, or utility. Renamed identifiers suggest copy-paste adaptation.',
      examples: [
        { before: '// Two modules implement identical data-pipeline logic with different variable names', after: '// Extract shared DataPipeline class/function and import in both modules', description: 'Extract shared structure' },
      ],
    },
    detector: async (files) => {
      const mod = await import('./duplication/structural-clones.js');
      return mod.detectStructuralClones(files);
    },
  },
];

export default catalog;

export function getPatternById(id: string): CatalogEntry | undefined {
  return catalog.find(e => e.definition.id === id);
}

export function getPatternsByCategory(category: string): CatalogEntry[] {
  return catalog.filter(e => e.definition.category === category);
}

export function getPatternsByLanguage(language: string): CatalogEntry[] {
  return catalog.filter(e => e.definition.languages.includes(language));
}
