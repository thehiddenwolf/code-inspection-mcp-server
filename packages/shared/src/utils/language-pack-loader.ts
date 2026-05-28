import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LanguagePack,
  ILanguagePackRegistry
} from '../types/language-pack.js';
import {
  LanguagePackSchema
} from '../schemas/language-pack.js';

/**
 * Utility to parse and construct a RegExp from a string.
 * Supports /pattern/flags format or raw pattern string.
 */
export function parseRegexString(patternStr: string, defaultFlags?: string): RegExp {
  try {
    const match = patternStr.match(/^\/((?:\\\/|[^\/])+)\/([dgimsuvy]*)$/);
    if (match) {
      const pattern = match[1];
      const flags = Array.from(new Set(match[2])).join('');
      return new RegExp(pattern, flags);
    }
    const cleanDefaultFlags = defaultFlags ? Array.from(new Set(defaultFlags)).join('') : undefined;
    return new RegExp(patternStr, cleanDefaultFlags);
  } catch (err: any) {
    throw new Error(`Invalid regular expression "${patternStr}": ${err.message}`, { cause: err });
  }
}

export class LanguagePackLoader {
  /**
   * Loads a language pack definition from a module file.
   */
  public static async loadFromFile(filePath: string): Promise<LanguagePack | LanguagePack[]> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    const fileUrl = pathToFileURL(filePath).href;
    const exports = await import(fileUrl);
    const pack = exports.default || exports.pack || exports.languagePack || exports;

    if (Array.isArray(pack)) {
      const validatedList: LanguagePack[] = [];
      for (const item of pack) {
        const validated = LanguagePackSchema.parse(item);
        validatedList.push(validated as LanguagePack);
      }
      return validatedList;
    }

    if (pack && pack.metadata && pack.parserName) {
      const validated = LanguagePackSchema.parse(pack);
      return validated as LanguagePack;
    }

    throw new Error('Module did not export a valid LanguagePack or array of LanguagePacks.');
  }

  /**
   * Discovers and loads all language pack modules (JS/TS files) in a directory.
   * Logs warnings for malformed packs.
   */
  public static async loadFromDirectory(directoryPath: string, registry: ILanguagePackRegistry): Promise<void> {
    if (!fs.existsSync(directoryPath)) {
      console.warn(`[LanguagePackLoader] Directory does not exist: ${directoryPath}`);
      return;
    }

    const files = fs.readdirSync(directoryPath);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (['.js', '.ts', '.mjs', '.cjs', '.mts', '.cts'].includes(ext)) {
        const filePath = path.join(directoryPath, file);
        try {
          const pack = await this.loadFromFile(filePath);
          if (Array.isArray(pack)) {
            for (const p of pack) {
              registry.register(p);
            }
          } else {
            registry.register(pack);
          }
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
 * If it points to a directory, it loads all modules inside it.
 */
export async function loadLanguagePacks(registry: ILanguagePackRegistry, configPath?: string): Promise<void> {
  if (!configPath) {
    return;
  }
  try {
    const stat = fs.statSync(configPath);
    if (stat.isDirectory()) {
      await LanguagePackLoader.loadFromDirectory(configPath, registry);
    } else if (stat.isFile()) {
      const pack = await LanguagePackLoader.loadFromFile(configPath);
      if (Array.isArray(pack)) {
        for (const p of pack) {
          registry.register(p);
        }
      } else {
        registry.register(pack);
      }
    }
  } catch (err: any) {
    console.warn(`[LanguagePackLoader] Warning: Failed to process configPath ${configPath}: ${err.message}`);
  }
}
