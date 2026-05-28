/**
 * Clean file with no anti-patterns.
 * Used as a negative control in pattern-miner tests.
 */

const MAX_RETRIES = 3;
const TIMEOUT_MS = 5000;
const PI = 3.14159;

interface Config {
  retries: number;
  timeout: number;
}

function computeArea(radius: number, config: Config): number {
  if (radius <= 0) {
    throw new Error('Radius must be positive');
  }
  return PI * radius * radius;
}

function fetchData(url: string): Promise<string> {
  return Promise.resolve(`data from ${url}`);
}

class Service {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async execute(): Promise<string> {
    try {
      const result = await fetchData('https://example.com/api');
      return result;
    } catch (error: unknown) {
      if (error instanceof Error) {
        return `error: ${error.message}`;
      }
      throw error;
    }
  }
}

export function calculateTotal(items: number[]): number {
  return items.reduce((sum, item) => sum + item, 0);
}

export const DEFAULT_CONFIG: Config = {
  retries: MAX_RETRIES,
  timeout: TIMEOUT_MS,
};
