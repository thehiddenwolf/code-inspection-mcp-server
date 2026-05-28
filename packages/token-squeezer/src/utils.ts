import { LanguagePackRegistry, type LanguagePack } from '@hermes/shared';
import { DEFAULT_PACKS } from './default-packs.js';

let defaultsRegistered = false;

/**
 * Register default language packs if they are not already in the registry.
 */
export function registerDefaultPacks(): void {
  if (defaultsRegistered) return;
  defaultsRegistered = true;
  const registry = LanguagePackRegistry.getInstance();
  for (const pack of DEFAULT_PACKS) {
    // Only register if extension not already registered to allow custom overrides
    for (const ext of pack.metadata.fileExtensions) {
      if (!registry.lookup(ext)) {
        registry.register(pack);
      }
    }
  }
}

/**
 * Get language pack associated with a language name or file extension.
 */
export function getLanguagePack(language: string): LanguagePack | undefined {
  registerDefaultPacks();
  const registry = LanguagePackRegistry.getInstance();

  // Try mapping common language names to extensions
  const langToExt: Record<string, string> = {
    python: '.py',
    go: '.go',
    typescript: '.ts',
    javascript: '.js',
    tsx: '.tsx',
    jsx: '.jsx',
  };

  const ext = langToExt[language.toLowerCase()];
  if (ext) {
    const pack = registry.lookup(ext);
    if (pack) return pack;
  }

  // If not found by extension, do lookup directly by extension if language is an extension
  if (language.startsWith('.')) {
    const pack = registry.lookup(language);
    if (pack) return pack;
  }

  // Fallback to name search
  return registry.getAll().find(
    p =>
      p.metadata.name.toLowerCase() === language.toLowerCase() ||
      p.metadata.name.toLowerCase().includes(language.toLowerCase()) ||
      p.parserName.toLowerCase().includes(language.toLowerCase())
  );
}
