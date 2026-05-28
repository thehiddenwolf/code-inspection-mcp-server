/**
 * @hermes/shared — Language Pack Types
 *
 * This file defines the TypeScript types and interfaces for the modular
 * Language Pack system, enabling dynamic language-specific parsing, comments,
 * and import handling rules across the MCP toolset.
 */

import type { PatternDefinitionType } from '../schemas/patterns.js';




/**
 * Metadata describing a Language Pack.
 */
export interface LanguagePackMetadata {
  /** The unique identifier name of the language pack (e.g., 'typescript-pack'). */
  name: string;
  /** Semantic version string (e.g., '0.1.0'). */
  version: string;
  /** File extensions associated with this language pack (e.g., ['.ts', '.tsx']). */
  fileExtensions: string[];
}

/**
 * An AST query definition used by Tree-sitter or other AST parsers.
 * Can be a raw query string or a structured object with options and captures.
 */
export type AstQuery =
  | string
  | {
      /** The raw query string (e.g., tree-sitter S-expression query). */
      query: string;
      /** Named captures targeted by this query. */
      captures?: string[];
      /** Optional configuration parameters for the parser query engine. */
      options?: Record<string, unknown>;
    };

/**
 * Dictionary of AST query definitions mapped by purpose (e.g., 'functions', 'classes').
 */
export interface AstQueries {
  [queryName: string]: AstQuery;
}

/**
 * Regex patterns for standard text-based preprocessing and fallback strategies.
 */
export interface RegexPatterns {
  /** Pattern to identify and match single-line and/or block comments. */
  commentDetection: RegExp;
  /** Optional pattern to match import declarations for token squeezing. */
  importExtraction?: RegExp;
  /** Optional pattern to match export declarations for context routing. */
  exportExtraction?: RegExp;
}

/**
 * Action rule for handling comments during token squeezing.
 */
export interface CommentHandlingRule {
  /** The action to take: strip completely, preserve as-is, keep docs only, or ignore. */
  action: 'strip' | 'preserve' | 'document' | 'ignore';
  /** Optional maximum lines allowed for a comment block before it gets truncated. */
  maxLines?: number;
  /** Optional custom handler identifier if custom transformation logic is required. */
  customHandlerName?: string;
}

/**
 * Action rule for handling imports during token squeezing.
 */
export interface ImportHandlingRule {
  /** The action to take: shrink/minimize, remove completely, or preserve. */
  action: 'shrink' | 'remove' | 'preserve';
  /** Whether to target only unused imports if usage analysis is available. */
  unusedOnly?: boolean;
  /** Optional custom handler identifier if custom transformation logic is required. */
  customHandlerName?: string;
}

/**
 * Unified execution rules for language processing/squeezing steps.
 */
export interface HandlingRules {
  /** Custom rules for comment parsing and compression. */
  comment?: CommentHandlingRule;
  /** Custom rules for import optimization. */
  import?: ImportHandlingRule;
}

/**
 * Rule for matching and replacing code bodies in fallback regex mode.
 */
export interface BodyPatternRule {
  pattern: RegExp;
  replacement: string;
}

/**
 * Rule for wildcard/shrunk import mappings.
 */
export interface WildcardRule {
  pattern: RegExp;
  replacement?: string;
  action: 'replace' | 'keep' | 'remove';
  sanitizeGroupIndex?: number;
}

/**
 * Specific rules for TokenSqueezer configuration.
 */
export interface SqueezerRules {
  bodyPlaceholder?: string;
  bodyPatterns?: BodyPatternRule[];
  privateBodyPatterns?: BodyPatternRule[];
  importStartRegex?: RegExp;
  importEndRegex?: RegExp;
  wildcardRules?: WildcardRule[];
  wildcardFallbackAction?: 'keep' | 'remove';
}

/**
 * Unified interface representing a modular Language Pack.
 *
 * @example
 * ```typescript
 * import type { LanguagePack } from '@hermes/shared';
 *
 * const TypeScriptPack: LanguagePack = {
 *   metadata: {
 *     name: 'typescript-pack',
 *     version: '1.0.0',
 *     fileExtensions: ['.ts', '.tsx', '.js', '.jsx']
 *   },
 *   parserName: 'tree-sitter-typescript',
 *   astQueries: {
 *     functions: '(function_declaration) @func',
 *     methods: '(method_definition) @method'
 *   },
 *   regexPatterns: {
 *     commentDetection: /\/\/.*|\/\*[\s\S]*?\*\//g,
 *     importExtraction: /^import\s+[\s\S]*?\s+from\s+['"].*?['"]/gm
 *   },
 *   rules: {
 *     comment: {
 *       action: 'document',
 *       maxLines: 10
 *     },
 *     import: {
 *       action: 'shrink',
 *       unusedOnly: true
 *     }
 *   }
 * };
 * ```
 */
/**
 * Specific rules for SOLID principle checks.
 */
export interface SolidEnforcerRules {
  classRegex?: RegExp;
  derivedClassRegex?: RegExp;
  interfaceRegex?: RegExp;
  concernPatterns?: Record<string, RegExp[]>;
  notImplementedPatterns?: RegExp[];
  newInstantiationRegex?: RegExp;
  staticCallRegex?: RegExp;
  valueObjectPatterns?: RegExp[];
}

export interface RepographSymbol {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'variable';
  exported: boolean;
  line: number;
  column: number;
  filePath: string;
  references?: { filePath: string; line: number }[];
}

export interface RepographEdge {
  from: string;
  to: string;
  type: 'defines' | 'imports' | 'calls' | 'extends' | 'implements';
  metadata?: Record<string, unknown>;
}

export interface RepographImport {
  source: string;
  names: string[];
  defaultName?: string;
}

export interface RepographPackRules {
  extractImports: (content: string, filePath: string) => RepographImport[];
  extractDeclarations: (content: string, filePath: string) => RepographSymbol[];
  extractRelationships: (content: string, filePath: string) => RepographEdge[];
}

export interface LanguagePack {
  /** Metadata of the language pack. */
  metadata: LanguagePackMetadata;
  /** The list of languages and/or file extensions this pack supports (e.g., ['ts', '.tsx', 'typescript']). */
  supportedLanguages: string[];
  /** File extensions associated with this language pack at the root level (e.g., ['.ts', '.tsx']). */
  fileExtensions: string[];
  /** Name of the parser instance/library (e.g., 'tree-sitter-typescript', 'python-ast'). */
  parserName: string;
  /** Optional custom repograph parser functions for extracting symbols and relationships. */
  repograph?: RepographPackRules;
  /** Optional set of AST queries to match key structures. */
  astQueries?: AstQueries;
  /** Optional regular expressions for fallback/regex-based processing. */
  regexPatterns?: RegexPatterns;
  /** Optional handling rules for preprocessing and reduction behaviors. */
  rules?: HandlingRules;
  /** Optional custom configuration for token squeezing. */
  squeezer?: SqueezerRules;
  /** Optional custom configuration for SOLID principle checks. */
  solidEnforcer?: SolidEnforcerRules;
  /** Optional custom configuration for LintFixer. */
  lintFix?: {
    commands?: string[][];
  };
  /** Optional custom configuration for PatternMiner. */
  patternMiner?: {
    patterns?: PatternDefinitionType[];
  };
}




// Ensure the global object has the declaration
declare global {
  var languagePacks: LanguagePack[] | undefined;
}

// Helper to get or initialize global.languagePacks
/**
 * Interface representing a registry for Language Packs.
 */
export interface ILanguagePackRegistry {
  register(pack: LanguagePack): void;
  lookup(fileExtension: string): LanguagePack | undefined;
  getLanguagePackByFileExtension(fileExtension: string): LanguagePack | undefined;
  getAll(): LanguagePack[];
}

/**
 * Registry for managing modular Language Packs.
 * Provides instance-based registration and lookup of packs.
 */
export class LanguagePackRegistry implements ILanguagePackRegistry {
  private static instance: LanguagePackRegistry | null = null;
  private packs: LanguagePack[] = [];

  /**
   * Retrieves the global singleton instance of the registry.
   */
  public static getInstance(): LanguagePackRegistry {
    if (!LanguagePackRegistry.instance) {
      LanguagePackRegistry.instance = new LanguagePackRegistry();
    }
    return LanguagePackRegistry.instance;
  }

  /**
   * Overrides or sets the global singleton instance (useful for testing or DI).
   */
  public static setInstance(registry: LanguagePackRegistry | null): void {
    LanguagePackRegistry.instance = registry;
  }

  /**
   * Registers a Language Pack and maps all its associated file extensions to it.
   */
  public register(pack: LanguagePack): void {
    if (!pack.supportedLanguages || pack.supportedLanguages.length === 0) {
      return;
    }
    // Avoid duplicate registration (check by metadata.name)
    const existingIndex = this.packs.findIndex(
      (p) => p.metadata.name.toLowerCase() === pack.metadata.name.toLowerCase()
    );
    if (existingIndex !== -1) {
      this.packs[existingIndex] = pack;
    } else {
      this.packs.push(pack);
    }
  }

  /**
   * Looks up a Language Pack by language name or file extension.
   */
  public lookup(langOrExt: string): LanguagePack | undefined {
    const clean = (s: string) => {
      let cleaned = s.trim().toLowerCase();
      if (cleaned.startsWith('.')) {
        cleaned = cleaned.slice(1);
      }
      return cleaned;
    };
    const queryClean = clean(langOrExt);
    for (let i = this.packs.length - 1; i >= 0; i--) {
      const p = this.packs[i];
      if (p.supportedLanguages?.some((lang) => clean(lang) === queryClean)) {
        return p;
      }
    }
    // Fallback to name search
    for (let i = this.packs.length - 1; i >= 0; i--) {
      const p = this.packs[i];
      if (clean(p.metadata?.name || '') === queryClean) {
        return p;
      }
    }
    return undefined;
  }

  /**
   * Looks up a Language Pack specifically by one of its supported file extensions.
   */
  public getLanguagePackByFileExtension(ext: string): LanguagePack | undefined {
    const clean = (s: string) => {
      let cleaned = s.trim().toLowerCase();
      if (cleaned.startsWith('.')) {
        cleaned = cleaned.slice(1);
      }
      return cleaned;
    };
    const extClean = clean(ext);
    for (let i = this.packs.length - 1; i >= 0; i--) {
      const p = this.packs[i];
      if (p.fileExtensions?.some((e) => clean(e) === extClean)) {
        return p;
      }
    }
    return undefined;
  }

  /**
   * Returns all unique registered Language Packs.
   */
  public getAll(): LanguagePack[] {
    return this.packs;
  }

  /**
   * Normalizes file extensions by converting them to lowercase and ensuring a leading dot.
   */
  protected normalizeExtension(ext: string): string {
    let normalized = ext.trim().toLowerCase();
    if (normalized && !normalized.startsWith('.')) {
      normalized = '.' + normalized;
    }
    return normalized;
  }
}

