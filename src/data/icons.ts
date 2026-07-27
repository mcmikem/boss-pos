// Product image helpers - use emoji by default (looks better than tiny SVGs)
// Set imageUrl to a base64 data URI or leave empty for emoji fallback

export function getIconForProduct(_productName: string, _category: string): string {
  return '';
}

export function enrichProductsWithIcons<T extends { imageUrl?: string }>(products: T[]): T[] {
  return products.map(p => ({
    ...p,
    imageUrl: p.imageUrl || ''
  }));
}
