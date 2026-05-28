/**
 * Clone fixture B — contains functions duplicated from clone-a.ts
 * Also has some unique code to verify the detector doesn't false-positive.
 */

function processUserData(records: { id: number; name: string; email: string }[]): string[] {
  const output: string[] = [];
  for (const record of records) {
    const formatted = `${record.name} <${record.email}>`;
    output.push(formatted);
  }
  return output.sort();
}

function calculateStats(numbers: number[]): { min: number; max: number; avg: number; sum: number } {
  if (numbers.length === 0) {
    return { min: 0, max: 0, avg: 0, sum: 0 };
  }
  const total = numbers.reduce((acc, v) => acc + v, 0);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const avg = total / numbers.length;
  return { min, max, avg, sum };
}

function formatTimestamp(ts: Date): string {
  const year = ts.getFullYear();
  const month = String(ts.getMonth() + 1).padStart(2, '0');
  const day = String(ts.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function uniqueFunctionB(): string {
  return 'This function only exists in clone-b.ts — totally different';
}
