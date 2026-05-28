import { z } from 'zod';
import { PatternDefinition } from './patterns.js';

export const LanguagePackMetadataSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  fileExtensions: z.array(z.string().min(1)),
});

export const AstQuerySchema = z.union([
  z.string(),
  z.object({
    query: z.string(),
    captures: z.array(z.string()).optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
]);

export const AstQueriesSchema = z.record(z.string(), AstQuerySchema);

export const CommentHandlingRuleSchema = z.object({
  action: z.enum(['strip', 'preserve', 'document', 'ignore']),
  maxLines: z.number().optional(),
  customHandlerName: z.string().optional(),
});

export const ImportHandlingRuleSchema = z.object({
  action: z.enum(['shrink', 'remove', 'preserve']),
  unusedOnly: z.boolean().optional(),
  customHandlerName: z.string().optional(),
});

export const HandlingRulesSchema = z.object({
  comment: CommentHandlingRuleSchema.optional(),
  import: ImportHandlingRuleSchema.optional(),
});

export const RegexPatternsSchema = z.object({
  commentDetection: z.instanceof(RegExp),
  importExtraction: z.instanceof(RegExp).optional(),
  exportExtraction: z.instanceof(RegExp).optional(),
});

export const SqueezerRulesSchema = z.object({
  bodyPlaceholder: z.string().optional(),
  bodyPatterns: z.array(z.object({
    pattern: z.instanceof(RegExp),
    replacement: z.string(),
  })).optional(),
  privateBodyPatterns: z.array(z.object({
    pattern: z.instanceof(RegExp),
    replacement: z.string(),
  })).optional(),
  importStartRegex: z.instanceof(RegExp).optional(),
  importEndRegex: z.instanceof(RegExp).optional(),
  wildcardRules: z.array(z.object({
    pattern: z.instanceof(RegExp),
    replacement: z.string().optional(),
    action: z.enum(['replace', 'keep', 'remove']),
    sanitizeGroupIndex: z.number().optional(),
  })).optional(),
  wildcardFallbackAction: z.enum(['keep', 'remove']).optional(),
});

export const SolidEnforcerRulesSchema = z.object({
  classRegex: z.instanceof(RegExp).optional(),
  derivedClassRegex: z.instanceof(RegExp).optional(),
  interfaceRegex: z.instanceof(RegExp).optional(),
  concernPatterns: z.record(z.string(), z.array(z.instanceof(RegExp))).optional(),
  notImplementedPatterns: z.array(z.instanceof(RegExp)).optional(),
  newInstantiationRegex: z.instanceof(RegExp).optional(),
  staticCallRegex: z.instanceof(RegExp).optional(),
  valueObjectPatterns: z.array(z.instanceof(RegExp)).optional(),
});

export const LintFixRulesSchema = z.object({
  commands: z.array(z.array(z.string())).optional(),
});

export const PatternMinerRulesSchema = z.object({
  patterns: z.array(PatternDefinition).optional(),
});

export const RepographRulesSchema = z.object({
  extractImports: z.function(),
  extractDeclarations: z.function(),
  extractRelationships: z.function(),
});

export const LanguagePackSchema = z.object({
  metadata: LanguagePackMetadataSchema,
  supportedLanguages: z.array(z.string().min(1)),
  fileExtensions: z.array(z.string().min(1)).optional(),
  parserName: z.string().min(1),
  repograph: RepographRulesSchema.optional(),
  astQueries: AstQueriesSchema.optional(),
  regexPatterns: RegexPatternsSchema.optional(),
  rules: HandlingRulesSchema.optional(),
  squeezer: SqueezerRulesSchema.optional(),
  solidEnforcer: SolidEnforcerRulesSchema.optional(),
  lintFix: LintFixRulesSchema.optional(),
  patternMiner: PatternMinerRulesSchema.optional(),
});


