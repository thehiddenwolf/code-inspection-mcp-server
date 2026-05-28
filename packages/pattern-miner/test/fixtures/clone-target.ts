/**
 * Fixture: A structurally similar file to clone-source.ts.
 * Same patterns but different identifiers and types.
 * Used to test clone detection across files.
 */

export interface Product {
  price: number;
  name: string;
}

export function calculateProducts(products: Product[]): number {
  let sum = 0;
  for (let idx = 0; idx < products.length; idx++) {
    sum += products[idx].price;
  }
  return sum;
}

export function filterByName(products: Product[], search: string): Product[] {
  const matched: Product[] = [];
  for (let idx = 0; idx < products.length; idx++) {
    if (products[idx].name.startsWith(search)) {
      matched.push(products[idx]);
    }
  }
  return matched;
}
