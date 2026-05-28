import type { Symbol, GraphEdge } from '../types.js';
import { LanguagePackRegistry } from '@hermes/shared';

export interface LanguageParser {
  extensions: string[];
  extractImports(content: string, filePath: string): Array<{ source: string; names: string[]; defaultName?: string }>;
  extractDeclarations(content: string, filePath: string): Symbol[];
  extractRelationships(content: string, filePath: string): GraphEdge[];
}

export function getParserForFile(filePath: string): LanguageParser | undefined {
  const extIndex = filePath.lastIndexOf('.');
  if (extIndex === -1) return undefined;
  const ext = filePath.slice(extIndex).toLowerCase();

  const registry = LanguagePackRegistry.getInstance();
  const pack = registry.getLanguagePackByFileExtension(ext);
  if (pack && pack.repograph) {
    return {
      extensions: pack.fileExtensions,
      extractImports: pack.repograph.extractImports,
      extractDeclarations: pack.repograph.extractDeclarations,
      extractRelationships: pack.repograph.extractRelationships,
    };
  }
  return undefined;
}

export function getSupportedExtensions(): Set<string> {
  const extensions = new Set<string>();
  const packs = LanguagePackRegistry.getInstance().getAll();
  for (const pack of packs) {
    if (pack.repograph) {
      for (const ext of pack.fileExtensions) {
        extensions.add(ext.toLowerCase());
      }
    }
  }
  return extensions;
}
