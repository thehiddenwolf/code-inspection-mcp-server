/**
 * @hermes/shared — Language Pack Types
 *
 * This file defines the TypeScript types and interfaces for the modular
 * Language Pack system, enabling dynamic language-specific parsing, comments,
 * and import handling rules across the MCP toolset.
 */



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
export interface LanguagePack {
  /** Metadata of the language pack. */
  metadata: LanguagePackMetadata;
  /** Name of the parser instance/library (e.g., 'tree-sitter-typescript', 'python-ast'). */
  parserName: string;
  /** Optional set of AST queries to match key structures. */
  astQueries?: AstQueries;
  /** Optional regular expressions for fallback/regex-based processing. */
  regexPatterns?: RegexPatterns;
  /** Optional handling rules for preprocessing and reduction behaviors. */
  rules?: HandlingRules;
  /** Optional custom configuration for token squeezing. */
  squeezer?: SqueezerRules;
}



/**
 * Interface representing a registry for Language Packs.
 */
export interface ILanguagePackRegistry {
  register(pack: LanguagePack): void;
  lookup(fileExtension: string): LanguagePack | undefined;
  getAll(): LanguagePack[];
}

/**
 * Registry for managing modular Language Packs.
 * Provides thread-safe / single-threaded registration and lookup of packs by file extension.
 */
export class LanguagePackRegistry implements ILanguagePackRegistry {
  protected map = new Map<string, LanguagePack>();

  private static instance: LanguagePackRegistry | null = null;

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
  public static setInstance(registry: LanguagePackRegistry): void {
    LanguagePackRegistry.instance = registry;
  }

  /**
   * Registers a Language Pack and maps all its associated file extensions to it.
   */
  public register(pack: LanguagePack): void {
    if (!pack.metadata?.fileExtensions) {
      return;
    }
    for (const ext of pack.metadata.fileExtensions) {
      const normalized = this.normalizeExtension(ext);
      this.map.set(normalized, pack);
    }
  }

  /**
   * Looks up a Language Pack by file extension.
   */
  public lookup(fileExtension: string): LanguagePack | undefined {
    const normalized = this.normalizeExtension(fileExtension);
    return this.map.get(normalized);
  }

  /**
   * Returns all unique registered Language Packs.
   */
  public getAll(): LanguagePack[] {
    return Array.from(new Set(this.map.values()));
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

