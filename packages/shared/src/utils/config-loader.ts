import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ILanguagePackRegistry, LanguagePack } from '../types/language-pack.js';
import { LanguagePackLoader } from './language-pack-loader.js';
import { ServerConfigSchema, JsonServerConfig } from '../schemas/server-config.js';
import { createLogger } from './logging.js';

const log = createLogger('config-loader');

export interface ParsedReference {
  type: 'file' | 'npm' | 'git';
  raw: string;
  resolvedPath?: string;
  packageName?: string;
  gitUrl?: string;
  gitRef?: string;
}

/**
 * Searches for hermes-config.json or similar files in process.cwd(), .code-inspect-mcp/ or ~/.code-inspect-mcp/.
 * Defaults to .code-inspection-mcp.json in the user's home directory.
 */
export function findServerConfigPath(customPath?: string): string | undefined {
  if (customPath) {
    const abs = path.resolve(customPath);
    if (fs.existsSync(abs)) {
      return abs;
    }
  }

  const defaults = [
    path.join(os.homedir(), '.code-inspection-mcp.json'),
    path.join(process.cwd(), '.code-inspection-mcp.json'),
    path.join(process.cwd(), 'hermes-config.json'),
    path.join(process.cwd(), '.code-inspect-mcp', 'config.json'),
    path.join(os.homedir(), '.code-inspect-mcp', 'config.json'),
  ];

  for (const p of defaults) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return undefined;
}

/**
 * Parses a configuration string into a structured reference type.
 */
export function parseLanguagePackRef(refStr: string, configDir: string): ParsedReference {
  const gitRegex = /^(git\+|git:\/\/|https:\/\/github\.com\/|http:\/\/github\.com\/)/i;

  if (gitRegex.test(refStr) || refStr.endsWith('.git') || refStr.includes('.git#')) {
    const hashIndex = refStr.indexOf('#');
    let gitUrl = refStr;
    let gitRef: string | undefined;
    if (hashIndex !== -1) {
      gitUrl = refStr.substring(0, hashIndex);
      gitRef = refStr.substring(hashIndex + 1);
    }
    if (gitUrl.toLowerCase().startsWith('git+')) {
      gitUrl = gitUrl.substring(4);
    }
    return { type: 'git', raw: refStr, gitUrl, gitRef };
  }

  const isExplicitPath = refStr.startsWith('.') || refStr.startsWith('/') || path.isAbsolute(refStr);
  const resolvedPath = path.resolve(configDir, refStr);

  if (isExplicitPath || fs.existsSync(resolvedPath)) {
    return { type: 'file', raw: refStr, resolvedPath };
  }

  return { type: 'npm', raw: refStr, packageName: refStr };
}

/**
 * Helper to register module exports to the registry.
 * Inspects default, pack, languagePack, or named exports.
 */
export function registerModule(exports: any, registry: ILanguagePackRegistry): void {
  const pack = exports.default || exports.pack || exports.languagePack || exports;
  if (pack && pack.metadata && pack.parserName) {
    registry.register(pack as LanguagePack);
    log.info(`Successfully registered language pack: ${pack.metadata.name}`);
  } else if (Array.isArray(pack)) {
    for (const p of pack) {
      if (p && p.metadata && p.parserName) {
        registry.register(p as LanguagePack);
        log.info(`Successfully registered language pack: ${p.metadata.name}`);
      }
    }
  } else {
    throw new Error('Module did not export a valid LanguagePack or array of LanguagePacks.');
  }
}

/**
 * Loads a language pack from a local file or directory module path.
 */
export async function loadPackFromLocalPath(
  absolutePath: string,
  registry: ILanguagePackRegistry
): Promise<void> {
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    log.info(`Loading local module language pack file: ${absolutePath}`);
    const pack = await LanguagePackLoader.loadFromFile(absolutePath);
    if (Array.isArray(pack)) {
      for (const p of pack) {
        registry.register(p);
      }
    } else {
      registry.register(pack);
    }
  } else if (stat.isDirectory()) {
    log.info(`Resolving directory module at path: ${absolutePath}`);
    const packageJsonPath = path.join(absolutePath, 'package.json');
    const indexJsPath = path.join(absolutePath, 'index.js');
    const indexMjsPath = path.join(absolutePath, 'index.mjs');
    const indexTsPath = path.join(absolutePath, 'index.ts');

    if (fs.existsSync(packageJsonPath) || fs.existsSync(indexJsPath) || fs.existsSync(indexMjsPath) || fs.existsSync(indexTsPath)) {
      log.info(`Importing directory module: ${absolutePath}`);
      const pack = await LanguagePackLoader.loadFromFile(absolutePath);
      if (Array.isArray(pack)) {
        for (const p of pack) {
          registry.register(p);
        }
      } else {
        registry.register(pack);
      }
    } else {
      await LanguagePackLoader.loadFromDirectory(absolutePath, registry);
    }
  }
}

/**
 * Loads the server configuration and registers all specified language packs.
 */
export async function loadConfigAndPacks(
  registry: ILanguagePackRegistry,
  configPath?: string
): Promise<void> {
  let resolvedPath = findServerConfigPath(configPath);
  let rawContent: string | undefined;

  // 1. Try reading from environment variable config (either path or raw JSON)
  const envConfig = process.env.HERMES_CONFIG || process.env.CODE_INSPECTION_CONFIG;
  if (envConfig) {
    const trimmed = envConfig.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      log.info('Loading server configuration from raw JSON environment variable');
      rawContent = trimmed;
    } else if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      log.info('Loading server configuration from raw JSON array environment variable');
      rawContent = trimmed;
    } else {
      resolvedPath = path.resolve(trimmed);
    }
  }

  // 2. Read file content if configuration path exists
  if (!rawContent && resolvedPath) {
    log.info(`Loading server configuration from: ${resolvedPath}`);
    try {
      rawContent = fs.readFileSync(resolvedPath, 'utf8');
    } catch (err: any) {
      log.error(`Failed to read server configuration file: ${err.message}`);
    }
  }

  let config: { languagePacks?: string[] } = { languagePacks: [] };
  if (rawContent) {
    try {
      const parsed = JSON.parse(rawContent);
      const validated = ServerConfigSchema.parse(parsed);
      if (Array.isArray(validated)) {
        config = { languagePacks: validated };
      } else {
        config = { languagePacks: validated.languagePacks || [] };
      }
    } catch (err: any) {
      log.error(`Failed to parse or validate server configuration: ${err.message}`);
    }
  }

  // 3. Load from comma-separated list of language packs in environment variables
  const envPacksStr = process.env.HERMES_LANGUAGE_PACKS || process.env.CODE_INSPECTION_LANGUAGE_PACKS;
  if (envPacksStr) {
    log.info('Loading additional language packs from environment variable list');
    const envPacks = envPacksStr.split(',').map(s => s.trim()).filter(Boolean);
    if (!config.languagePacks) {
      config.languagePacks = [];
    }
    for (const ep of envPacks) {
      if (!config.languagePacks.includes(ep)) {
        config.languagePacks.push(ep);
      }
    }
  }

  if (!config.languagePacks || config.languagePacks.length === 0) {
    log.info('No custom language packs defined in server configuration.');
    return;
  }

  const configDir = resolvedPath ? path.dirname(resolvedPath) : process.cwd();

  for (const packRefStr of config.languagePacks) {
    try {
      const ref = parseLanguagePackRef(packRefStr, configDir);

      if (ref.type === 'file') {
        if (!ref.resolvedPath) continue;
        await loadPackFromLocalPath(ref.resolvedPath, registry);
      } else if (ref.type === 'npm') {
        if (!ref.packageName) continue;
        log.info(`Loading NPM language pack module: ${ref.packageName}`);
        try {
          const mod = await import(ref.packageName);
          registerModule(mod, registry);
        } catch (importErr: any) {
          try {
            const require = createRequire(import.meta.url);
            const resolvedNpmPath = require.resolve(ref.packageName);
            const mod = require(resolvedNpmPath);
            registerModule(mod, registry);
          } catch (reqErr: any) {
            log.error(`Failed to load NPM language pack ${ref.packageName}: ESM error: ${importErr.message}; CommonJS error: ${reqErr.message}`);
          }
        }
      } else if (ref.type === 'git') {
        if (!ref.gitUrl) continue;
        log.info(`Loading Git language pack from repository: ${ref.gitUrl}`);

        const cacheDir = path.join(os.homedir(), '.code-inspect-mcp', 'git-cache');
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }

        const repoDirName = encodeURIComponent(ref.gitUrl).replace(/%/g, '_');
        const repoPath = path.join(cacheDir, repoDirName);

        try {
          if (!fs.existsSync(repoPath)) {
            log.info(`Cloning git repository ${ref.gitUrl} to ${repoPath}`);
            execSync(`git clone "${ref.gitUrl}" "${repoPath}"`, { stdio: 'ignore' });
          } else {
            log.info(`Pulling updates for git repository at ${repoPath}`);
            try {
              execSync(`git -C "${repoPath}" pull`, { stdio: 'ignore' });
            } catch (pullErr: any) {
              log.warn(`Git pull failed, using cached files. Error: ${pullErr.message}`);
            }
          }

          if (ref.gitRef) {
            log.info(`Checking out ref/branch: ${ref.gitRef}`);
            execSync(`git -C "${repoPath}" checkout "${ref.gitRef}"`, { stdio: 'ignore' });
          }

          await loadPackFromLocalPath(repoPath, registry);
        } catch (gitErr: any) {
          log.error(`Git operations failed for ${ref.gitUrl}: ${gitErr.message}`);
        }
      }
    } catch (packErr: any) {
      log.error(`Error processing language pack reference "${packRefStr}": ${packErr.message}`);
    }
  }
}
