import type { Symbol, GraphEdge } from '../types.js';

export interface LanguageParser {
  extensions: string[];
  extractImports(content: string, filePath: string): Array<{ source: string; names: string[]; defaultName?: string }>;
  extractDeclarations(content: string, filePath: string): Symbol[];
  extractRelationships(content: string, filePath: string): GraphEdge[];
}

const registry = new Map<string, LanguageParser>();

export function registerParser(parser: LanguageParser): void {
  for (const ext of parser.extensions) {
    registry.set(ext.toLowerCase(), parser);
  }
}

import { JavaScriptParser } from './javascript.js';
import { CSharpParser } from './csharp.js';
import { VBNetParser } from './vbnet.js';

registerParser(JavaScriptParser);
registerParser(CSharpParser);
registerParser(VBNetParser);

export function getParserForFile(filePath: string): LanguageParser | undefined {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return registry.get(ext);
}

export function getSupportedExtensions(): Set<string> {
  return new Set(registry.keys());
}
