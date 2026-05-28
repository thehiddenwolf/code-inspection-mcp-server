// A simple utility module
import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Process a config file and return parsed values
 */
export async function loadConfig(path: string): Promise<Record<string, unknown>> {
  const content = await readFile(join(process.cwd(), path), 'utf-8');
  return JSON.parse(content);
}

function validateConfig(config: Record<string, unknown>): boolean {
  if (!config || typeof config !== 'object') return false;
  return 'name' in config && 'version' in config;
}

// Internal helper
function mergeDefaults(user: any, defaults: any): any {
  const result = { ...defaults };
  for (const key of Object.keys(user)) {
    result[key] = user[key];
  }  
  return result;
}
