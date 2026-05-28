import { z } from 'zod';

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

// Schema for raw JSON validation of Regex patterns
export const JsonRegexPatternsSchema = z.object({
  commentDetection: z.string().min(1),
  importExtraction: z.string().optional(),
  exportExtraction: z.string().optional(),
});

// Schema for raw JSON validation of TokenSqueezer custom rules
export const JsonSqueezerRulesSchema = z.object({
  bodyPlaceholder: z.string().optional(),
  bodyPatterns: z.array(z.object({
    pattern: z.string().min(1),
    replacement: z.string(),
  })).optional(),
  privateBodyPatterns: z.array(z.object({
    pattern: z.string().min(1),
    replacement: z.string(),
  })).optional(),
  importStartRegex: z.string().optional(),
  importEndRegex: z.string().optional(),
  wildcardRules: z.array(z.object({
    pattern: z.string().min(1),
    replacement: z.string().optional(),
    action: z.enum(['replace', 'keep', 'remove']),
    sanitizeGroupIndex: z.number().optional(),
  })).optional(),
  wildcardFallbackAction: z.enum(['keep', 'remove']).optional(),
});

// Schema for raw JSON validation of the LanguagePack
export const JsonLanguagePackSchema = z.object({
  metadata: LanguagePackMetadataSchema,
  parserName: z.string().min(1),
  astQueries: AstQueriesSchema.optional(),
  regexPatterns: JsonRegexPatternsSchema.optional(),
  rules: HandlingRulesSchema.optional(),
  squeezer: JsonSqueezerRulesSchema.optional(),
});

export type JsonLanguagePack = z.infer<typeof JsonLanguagePackSchema>;
