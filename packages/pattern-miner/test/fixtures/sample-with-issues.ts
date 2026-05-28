/**
 * Sample file with known anti-patterns for testing pattern-miner.
 * DO NOT FIX THESE — they're intentionally here for scan detection tests.
 */

// TODO: This entire function needs to be refactored
function processData(data: any): void {
  // Hardcoded secret
  const apiKey = 'sk-1234567890abcdef';
  const dbPassword = 'super_secret_db_pass_2024';

  while (data) {
    try {
      // Console.log left in code
      console.log('Processing data:', data);
      console.log('API Key:', apiKey);

      if (data) {
        if (data.value) {
          if (data.value > 42) {
            // Magic number: 42
            console.log('Value is', data.value);
            for (let i = 0; i < 10; i++) {
              if (i > 5) {
                // Magic number: 5
                return data.value * 3.14159; // Magic number: 3.14159
              }
            }
          }
        }
      }
    } catch {
      // Empty catch block
    }
  }
  return null;
}

// Unused export
export function unusedExportFunction(): string {
  return 'I am never imported';
}

// Another unused export
export const UNUSED_CONSTANT = 'this-is-not-used-anywhere';

function helperFunction() {
  // Deep nesting
  if (true) {
    if (true) {
      if (true) {
        if (true) {
          if (true) {
            return 'too deep';
          }
        }
      }
    }
  }
  return 'done';
}
