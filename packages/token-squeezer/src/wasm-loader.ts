/**
 * wasm-loader.ts
 *
 * Lazy Tree-sitter WASM loader.
 * Integrated with the modular Language Pack system.
 */

import type { SupportedLanguage } from './types.js';
import { LANGUAGE_GRAMMAR_MAP } from './types.js';
import { getLanguagePack } from './utils.js';
import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// We use dynamic import so web-tree-sitter is optional
type ParserType = import('web-tree-sitter').Parser;
type LanguageType = import('web-tree-sitter').Language;

let WS: typeof import('web-tree-sitter') | null = null;
const languageCache = new Map<string, LanguageType | null>();
let initPromise: Promise<boolean> | null = null;

/**
 * Try to initialize the web-tree-sitter runtime.
 * Returns true if successful, false if unavailable.
 */
async function ensureInit(): Promise<boolean> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const mod = await import('web-tree-sitter');
      WS = mod;
      await WS.Parser.init();
      return true;
    } catch {
      WS = null;
      return false;
    }
  })();

  return initPromise;
}

/**
 * Helper to locate a WASM grammar file across different possible paths.
 */
function locateWasm(grammarName: string): string | null {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  
  const pathsToTry = [
    // Packages node_modules path
    resolve(currentDir, '..', 'node_modules', 'tree-sitter-wasms', 'out', `tree-sitter-${grammarName}.wasm`),
    resolve(currentDir, '..', '..', 'node_modules', 'tree-sitter-wasms', 'out', `tree-sitter-${grammarName}.wasm`),
    // Monorepo root node_modules path
    resolve(currentDir, '..', '..', '..', 'node_modules', 'tree-sitter-wasms', 'out', `tree-sitter-${grammarName}.wasm`),
    // Fallback relative to process working directory
    resolve(process.cwd(), 'node_modules', 'tree-sitter-wasms', 'out', `tree-sitter-${grammarName}.wasm`),
    resolve(process.cwd(), `tree-sitter-${grammarName}.wasm`),
  ];

  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Create a parser for the given language.
 *
 * @param language - Language identifier ('typescript', 'python', etc.)
 * @returns A Tree-sitter Parser instance, or null if unavailable
 */
export async function createParser(language: string): Promise<ParserType | null> {
  const pack = getLanguagePack(language);
  let grammarName: string | undefined;

  if (pack?.parserName && pack.parserName.startsWith('tree-sitter-')) {
    grammarName = pack.parserName.replace('tree-sitter-', '');
  } else {
    const normalized = language.toLowerCase() as SupportedLanguage;
    grammarName = LANGUAGE_GRAMMAR_MAP[normalized];
  }

  if (!grammarName) return null;

  // Sanitize grammarName to prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(grammarName)) return null;

  // Ensure runtime is initialized
  const ready = await ensureInit();
  if (!ready || !WS) {
    return null;
  }

  // Check language cache first
  let lang = languageCache.get(grammarName);
  if (lang === undefined) {
    const wasmPath = locateWasm(grammarName);
    if (!wasmPath) {
      languageCache.set(grammarName, null);
      return null;
    }

    try {
      lang = await WS.Language.load(wasmPath);
      languageCache.set(grammarName, lang);
    } catch {
      languageCache.set(grammarName, null);
      return null;
    }
  }

  if (!lang) return null;

  try {
    const parser = new WS.Parser();
    parser.setLanguage(lang);
    return parser;
  } catch {
    return null;
  }
}

/**
 * Clear all cached languages (useful for testing or reloading).
 */
export function clearCache(): void {
  languageCache.clear();
  initPromise = null;
  WS = null;
}
