import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import {
  LanguagePack,
  ILanguagePackRegistry,
  SqueezerRules
} from '../types/language-pack.js';
import {
  JsonLanguagePackSchema,
  JsonLanguagePack
} from '../schemas/language-pack.js';

/**
 * Utility to parse and construct a RegExp from a string.
 * Supports /pattern/flags format or raw pattern string.
 */
export function parseRegexString(patternStr: string, defaultFlags?: string): RegExp {
  try {
    // Matches standard and ES6+ flags: d, g, i, m, s, u, v, y
    const match = patternStr.match(/^\/((?:\\\/|[^\/])+)\/([dgimsuvy]*)$/);
    if (match) {
      const pattern = match[1];
      // Deduplicate flags to avoid syntax/construction errors
      const flags = Array.from(new Set(match[2])).join('');
      return new RegExp(pattern, flags);
    }
    // Safe compilation for raw pattern string
    const cleanDefaultFlags = defaultFlags ? Array.from(new Set(defaultFlags)).join('') : undefined;
    return new RegExp(patternStr, cleanDefaultFlags);
  } catch (err: any) {
    throw new Error(`Invalid regular expression "${patternStr}": ${err.message}`);
  }
}

/**
 * Converts a validated JsonLanguagePack to a standard LanguagePack.
 */
export function convertJsonPackToPack(jsonPack: JsonLanguagePack): LanguagePack {
  const pack: LanguagePack = {
    metadata: jsonPack.metadata,
    parserName: jsonPack.parserName,
    astQueries: jsonPack.astQueries,
    rules: jsonPack.rules,
  };

  if (jsonPack.regexPatterns) {
    pack.regexPatterns = {
      commentDetection: parseRegexString(jsonPack.regexPatterns.commentDetection, 'g'),
    };
    if (jsonPack.regexPatterns.importExtraction) {
      pack.regexPatterns.importExtraction = parseRegexString(
        jsonPack.regexPatterns.importExtraction,
        'gm'
      );
    }
    if (jsonPack.regexPatterns.exportExtraction) {
      pack.regexPatterns.exportExtraction = parseRegexString(
        jsonPack.regexPatterns.exportExtraction,
        'gm'
      );
    }
  }

  if (jsonPack.squeezer) {
    const squeezer: SqueezerRules = {
      bodyPlaceholder: jsonPack.squeezer.bodyPlaceholder,
      wildcardFallbackAction: jsonPack.squeezer.wildcardFallbackAction,
    };
    if (jsonPack.squeezer.bodyPatterns) {
      squeezer.bodyPatterns = jsonPack.squeezer.bodyPatterns.map(bp => ({
        pattern: parseRegexString(bp.pattern, 'g'),
        replacement: bp.replacement,
      }));
    }
    if (jsonPack.squeezer.privateBodyPatterns) {
      squeezer.privateBodyPatterns = jsonPack.squeezer.privateBodyPatterns.map(pbp => ({
        pattern: parseRegexString(pbp.pattern, 'g'),
        replacement: pbp.replacement,
      }));
    }
    if (jsonPack.squeezer.importStartRegex) {
      squeezer.importStartRegex = parseRegexString(jsonPack.squeezer.importStartRegex);
    }
    if (jsonPack.squeezer.importEndRegex) {
      squeezer.importEndRegex = parseRegexString(jsonPack.squeezer.importEndRegex);
    }
    if (jsonPack.squeezer.wildcardRules) {
      squeezer.wildcardRules = jsonPack.squeezer.wildcardRules.map(wr => ({
        pattern: parseRegexString(wr.pattern),
        replacement: wr.replacement,
        action: wr.action,
        sanitizeGroupIndex: wr.sanitizeGroupIndex,
      }));
    }
    pack.squeezer = squeezer;
  }

  return pack;
}

export class LanguagePackLoader {
  /**
   * Loads a language pack definition from a JSON string.
   */
  public static loadFromString(jsonContent: string): LanguagePack {
    if (typeof jsonContent !== 'string') {
      throw new Error(`Invalid input: expected JSON string, received ${typeof jsonContent}`);
    }
    if (!jsonContent.trim()) {
      throw new Error('Invalid input: JSON string is empty');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(jsonContent);
    } catch (err: any) {
      throw new SyntaxError(`Invalid JSON format: ${err.message}`);
    }

    let validated: JsonLanguagePack;
    try {
      validated = JsonLanguagePackSchema.parse(raw);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issues = err.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        throw new Error(`Schema validation failed: ${issues}`);
      }
      throw err;
    }

    return convertJsonPackToPack(validated);
  }

  /**
   * Loads a language pack from a JSON file.
   */
  public static loadFromFile(filePath: string): LanguagePack {
    const content = fs.readFileSync(filePath, 'utf8');
    try {
      return this.loadFromString(content);
    } catch (err: any) {
      throw new Error(`Failed to load language pack from ${filePath}: ${err.message}`);
    }
  }

  /**
   * Discovers and loads all language packs in a directory.
   * Logs warnings for malformed packs.
   */
  public static loadFromDirectory(directoryPath: string, registry: ILanguagePackRegistry): void {
    if (!fs.existsSync(directoryPath)) {
      console.warn(`[LanguagePackLoader] Directory does not exist: ${directoryPath}`);
      return;
    }

    const files = fs.readdirSync(directoryPath);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(directoryPath, file);
        try {
          const pack = this.loadFromFile(filePath);
          registry.register(pack);
        } catch (err: any) {
          console.warn(`[LanguagePackLoader] Warning: Failed to load language pack file ${file}: ${err.message}`);
        }
      }
    }
  }
}

/**
 * Loads language packs dynamically into the registry.
 * If configPath points to a file, it loads that file.
 * If it points to a directory, it loads all JSON files inside it.
 */
export function loadLanguagePacks(registry: ILanguagePackRegistry, configPath?: string): void {
  if (!configPath) {
    return;
  }
  try {
    const stat = fs.statSync(configPath);
    if (stat.isDirectory()) {
      LanguagePackLoader.loadFromDirectory(configPath, registry);
    } else if (stat.isFile()) {
      const pack = LanguagePackLoader.loadFromFile(configPath);
      registry.register(pack);
    }
  } catch (err: any) {
    console.warn(`[LanguagePackLoader] Warning: Failed to process configPath ${configPath}: ${err.message}`);
  }
}
