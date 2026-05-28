/**
 * Fixture: Code that has structural clones.
 * Used by clone-detection tests to verify we can detect
 * structurally similar code in different files.
 */

export interface Item {
  value: number;
  label: string;
}

export function processItems(items: Item[]): number {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].value;
  }
  return total;
}

export function filterByLabel(items: Item[], prefix: string): Item[] {
  const result: Item[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].label.startsWith(prefix)) {
      result.push(items[i]);
    }
  }
  return result;
}
