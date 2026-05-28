import { LanguagePackRegistry, type LanguagePack } from '@hermes/shared';

/**
 * Normalizes language names or extensions for comparison.
 */
function normalizeLang(lang: string): string {
  return lang.trim().toLowerCase();
}

export function lookupGlobalPack(extOrName: string): LanguagePack | undefined {
  const registry = LanguagePackRegistry.getInstance();
  if (extOrName.startsWith('.') || extOrName.length <= 4) {
    const pack = registry.getLanguagePackByFileExtension(extOrName);
    if (pack) return pack;
  }
  return registry.lookup(extOrName);
}

/**
 * Get language pack associated with a language name or file extension.
 */
export function getLanguagePack(language: string): LanguagePack | undefined {
  // 1. First look it up in global packs
  const pack = lookupGlobalPack(language);
  if (pack) return pack;

  // 2. Try mapping common language names to extensions/names
  const langToExt: Record<string, string> = {
    python: '.py',
    go: '.go',
    typescript: '.ts',
    javascript: '.js',
    tsx: '.tsx',
    jsx: '.jsx',
  };

  const mapped = langToExt[language.toLowerCase()];
  if (mapped) {
    const packMapped = lookupGlobalPack(mapped);
    if (packMapped) return packMapped;
  }

  // 3. Fallback to substring name search in global packs
  const registry = LanguagePackRegistry.getInstance();
  const packs = registry.getAll();
  const normalized = normalizeLang(language);
  for (let i = packs.length - 1; i >= 0; i--) {
    const p = packs[i];
    if (
      p.metadata?.name?.toLowerCase().includes(normalized) ||
      p.parserName?.toLowerCase().includes(normalized)
    ) {
      return p;
    }
  }
  return undefined;
}
