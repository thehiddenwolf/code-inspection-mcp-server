/**
 * Clone fixture A — contains functions that are duplicated in clone-b.ts
 * Used to test PMD CPD tokenized clone detection.
 */

function processUserData(users: { id: number; name: string; email: string }[]): string[] {
  const results: string[] = [];
  for (const user of users) {
    const formatted = `${user.name} <${user.email}>`;
    results.push(formatted);
  }
  return results.sort();
}

function calculateStats(values: number[]): { min: number; max: number; avg: number; sum: number } {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, sum: 0 };
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = sum / values.length;
  return { min, max, avg, sum };
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function uniqueFunctionA(): string {
  return 'This function only exists in clone-a.ts';
}
