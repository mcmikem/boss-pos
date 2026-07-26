// Product image helpers - use emoji by default (looks better than tiny SVGs)
// Set imageUrl to a base64 data URI or leave empty for emoji fallback

export function getIconForProduct(productName: string, category: string): string {
  return ''; // Return empty so the UI shows emoji fallback instead
}

export function enrichProductsWithIcons(products: any[]): any[] {
  return products.map(p => ({
    ...p,
    imageUrl: p.imageUrl || ''
  }));
}
