import type { AggressivenessLevel, OutputFormat } from '@hermes/shared';

/** Fully resolved squeeze options — all fields defaulted */
export interface SqueezeOptions {
  preserve_comments: boolean;
  preserve_imports: boolean;
  aggressiveness: AggressivenessLevel;
  max_tokens?: number;
  include_private: boolean;
  output_format: OutputFormat;
  outline?: boolean;
}

/** Result shape returned by the squeezer */
export interface SqueezedResult {
  original: string;
  squeezed: string;
  original_tokens: number;
  squeezed_tokens: number;
  reduction_ratio: number;
  aggressiveness: string;
  language: string;
  node_counts?: { original: number; removed: number };
}

/** Languages we can attempt to parse */
export type SupportedLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'go'
  | 'jsx'
  | 'tsx'
  | 'csharp'
  | 'vbnet'
  | 'rust'
  | 'java'
  | 'json'
  | 'html'
  | 'css'
  | 'yaml';

/** Maps internal language names to tree-sitter grammar names */
export const LANGUAGE_GRAMMAR_MAP: Record<SupportedLanguage, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  go: 'go',
  jsx: 'jsx',
  tsx: 'tsx',
  csharp: 'c-sharp',
  vbnet: 'vbnet',
  rust: 'rust',
  java: 'java',
  json: 'json',
  html: 'html',
  css: 'css',
  yaml: 'yaml',
};

/** Maps file extensions to supported languages */
export const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.py': 'python',
  '.go': 'go',
  '.cs': 'csharp',
  '.vb': 'vbnet',
  '.rs': 'rust',
  '.java': 'java',
  '.json': 'json',
  '.html': 'html',
  '.css': 'css',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

