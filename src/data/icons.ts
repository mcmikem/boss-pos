// Tiny optimized SVG data URIs (32x32px) for offline use, very small bandwidth footprint
export const PRODUCT_ICONS = {
  // Electronics
  phone: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB4PSI0IiB5PSIyIiB3aWR0aD0iMjQiIGhlaWdodD0iMjgiIHJ4PSIyIiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjxjaXJjbGUgY3g9IjE2IiBjeT0iMjUiIHI9IjEuNSIgZmlsbD0iI2ZmY2MwMCIvPjwvc3ZnPg==',
  charger: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB4PSI4IiB5PSI1IiB3aWR0aD0iMTYiIGhlaWdodD0iMjAiIHJ4PSIyIiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjxyZWN0IHg9IjEwIiB5PSI5IiB3aWR0aD0iMTIiIGhlaWdodD0iOCIgZmlsbD0iI2ZmY2MwMCIgb3BhY2l0eT0iMC43Ii8+PC9zdmc+',
  earphones: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI5IiBjeT0iMTgiIHI9IjMiIHN0cm9rZT0iI2ZmY2MwMCIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJub25lIi8+PGNpcmNsZSBjeD0iMjMiIGN5PSIxOCIgcj0iMyIgc3Ryb2tlPSIjZmZjYzAwIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz48cGF0aCBkPSJNIDkgMTUgUSA5IDYgMTUgNiIgc3Ryb2tlPSIjZmZjYzAwIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz48cGF0aCBkPSJNIDIzIDE1IFEgMjMgNiAxNyA2IiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjwvc3ZnPg==',
  powerbank: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB4PSI2IiB5PSI4IiB3aWR0aD0iMjAiIGhlaWdodD0iMTYiIHJ4PSIyIiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjxyZWN0IHg9IjciIHk9IjkiIHdpZHRoPSI0IiBoZWlnaHQ9IjIiIGZpbGw9IiNmZmNjMDAiLz48cmVjdCB4PSI5IiB5PSIxNyIgd2lkdGg9IjEyIiBoZWlnaHQ9IjQiIGZpbGw9IiNmZmNjMDAiIG9wYWNpdHk9IjAuNiIvPjwvc3ZnPg==',
  
  // Eatery
  food: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNIDggMjQgTCA4IDYgUSA4IDQgMTAgNEwgMjIgNFEgMjQgNCAyNCA2TCAyNCAyNCBDIDI0IDI2LjIgMjIuMiAyOCAyMCAyOEwgMTIgMjhDIDkuOCAyOCA4IDI2LjIgOCAyNCBaIiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0iI2ZmY2MwMCIgb3BhY2l0eT0iMC4zIi8+PC9zdmc+',
  drink: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB4PSI4IiB5PSI0IiB3aWR0aD0iMTYiIGhlaWdodD0iMjAiIHJ4PSIyIiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0iI2ZmY2MwMCIgb3BhY2l0eT0iMC4zIi8+PGxpbmUgeDE9IjEwIiB5MT0iMTYiIHgyPSIyMiIgeTI9IjE2IiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==',

  // Stationery
  notebook: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB4PSI1IiB5PSI0IiB3aWR0aD0iMjIiIGhlaWdodD0iMjQiIHJ4PSIyIiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjxsaW5lIHgxPSI1IiB5MT0iOCIgeDI9IjI3IiB5Mj0iOCIgc3Ryb2tlPSIjZmZjYzAwIiBzdHJva2Utd2lkdGg9IjEiLz48bGluZSB4MT0iNSIgeTE9IjEyIiB4Mj0iMjciIHkyPSIxMiIgc3Ryb2tlPSIjZmZjYzAwIiBzdHJva2Utd2lkdGg9IjEiLz48bGluZSB4MT0iNSIgeTE9IjE2IiB4Mj0iMjciIHkyPSIxNiIgc3Ryb2tlPSIjZmZjYzAwIiBzdHJva2Utd2lkdGg9IjEiLz48L3N2Zz4=',
  pen: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNIDI0IDQgTCA0IDE4IEwgMTAgMjQgTCAyNCAxMCBaIiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0iIzBBMEEwQSIvPjxwb2x5Z29uIHBvaW50cz0iOCwyNiAxMCwyNCAxLDI0IiBmaWxsPSIjZmZjYzAwIi8+PC9zdmc+',

  // Printing
  printer: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB4PSI0IiB5PSI0IiB3aWR0aD0iMjQiIGhlaWdodD0iMjAiIHJ4PSIyIiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjxyZWN0IHg9IjgiIHk9IjEwIiB3aWR0aD0iMTYiIGhlaWdodD0iOCIgZmlsbD0iI2ZmY2MwMCIgb3BhY2l0eT0iMC4zIi8+PC9zdmc+',

  // Tailoring
  shirt: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNIDEyIDQgTCA2IDggTCA2IDE4IEwgMjAgMTggTCAyMCA4IEwgMTQgNCBaIiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0iI2ZmY2MwMCIgb3BhY2l0eT0iMC4zIi8+PGNpcmNsZSBjeD0iMTAiIGN5PSI4IiByPSIyIiBmaWxsPSIjZmZjYzAwIi8+PGNpcmNsZSBjeD0iMjIiIGN5PSI4IiByPSIyIiBmaWxsPSIjZmZjYzAwIi8+PC9zdmc+',

  // Library
  film: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB4PSI0IiB5PSI4IiB3aWR0aD0iMjQiIGhlaWdodD0iMTYiIHJ4PSIyIiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjxwb2x5Z29uIHBvaW50cz0iMTYsMTIgMjEsMTYgMTYsMjAiIGZpbGw9IiNmZmNjMDAiLz48L3N2Zz4=',
  music: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNIDEyIDQgTCAxMiAyMCBDIDEyIDIyLjIgMTMuOCAyNCAyNiAyNSIgc3Ryb2tlPSIjZmZjYzAwIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMjMiIHI9IjIuNSIgZmlsbD0iI2ZmY2MwMCIvPjxjaXJjbGUgY3g9IjI2IiBjeT0iMjUiIHI9IjIuNSIgZmlsbD0iI2ZmY2MwMCIvPjwvc3ZnPg==',

  // Sports
  ball: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxMiIgc3Ryb2tlPSIjZmZjYzAwIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz48cGF0aCBkPSJNIDE2IDQgQSAxMiAxMiAwIDAgMSAxNiAyOCBNIDQgMTYgQSAxMiAxMiAwIDAgMCAyOCAxNiIgc3Ryb2tlPSIjZmZjYzAwIiBzdHJva2Utd2lkdGg9IjEiIHN0cm9rZS1kYXNoYXJyYXk9IjIsMiIgZmlsbD0ibm9uZSIvPjwvc3ZnPg==',

  // Graphics
  pen_tool: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB4PSI1IiB5PSI1IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIHJ4PSIyIiBzdHJva2U9IiNmZmNjMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjIuNSIgZmlsbD0iI2ZmY2MwMCIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMjAiIHI9IjIuNSIgZmlsbD0iI2ZmY2MwMCIvPjwvc3ZnPg==',

  // Generic
  package: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNIDQgMTAgTCA0IDI0IFEgNCAxNiAxNiAyOCBRIDI4IDE2IDI4IDI0IEwgMjggMTAiIHN0cm9rZT0iI2ZmY2MwMCIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJub25lIi8+PHBhdGggZD0iTSA0IDEwIEwgMTYgNiBMMjggMTAiIHN0cm9rZT0iI2ZmY2MwMCIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSIjZmZjYzAwIiBvcGFjaXR5PSIwLjMiLz48L3N2Zz4=',
};

export function getIconForProduct(productName: string, category: string): string {
  const nameL = productName.toLowerCase();
  const catL = category.toLowerCase();

  // Electronics
  if (nameL.includes('phone') || nameL.includes('oppo') || nameL.includes('samsung') || nameL.includes('galaxy')) return PRODUCT_ICONS.phone;
  if (nameL.includes('charger') || nameL.includes('charging')) return PRODUCT_ICONS.charger;
  if (nameL.includes('earphone') || nameL.includes('earbud') || nameL.includes('tws')) return PRODUCT_ICONS.earphones;
  if (nameL.includes('power bank')) return PRODUCT_ICONS.powerbank;

  // Eatery
  if (catL === 'eatery' || nameL.includes('rolex') || nameL.includes('chapati') || nameL.includes('samosa')) return PRODUCT_ICONS.food;
  if (nameL.includes('soda') || nameL.includes('water') || nameL.includes('juice') || nameL.includes('tea')) return PRODUCT_ICONS.drink;

  // Stationery
  if (nameL.includes('book') || nameL.includes('notebook') || nameL.includes('exercise')) return PRODUCT_ICONS.notebook;
  if (nameL.includes('pen') || nameL.includes('pencil') || nameL.includes('marker')) return PRODUCT_ICONS.pen;

  // Printing
  if (catL === 'printing' || nameL.includes('print') || nameL.includes('photocopy') || nameL.includes('lamination')) return PRODUCT_ICONS.printer;

  // Tailoring
  if (catL === 'tailoring' || nameL.includes('shirt') || nameL.includes('dress') || nameL.includes('uniform') || nameL.includes('trouser')) return PRODUCT_ICONS.shirt;

  // Library
  if (nameL.includes('film') || nameL.includes('movie') || nameL.includes('download')) return PRODUCT_ICONS.film;
  if (nameL.includes('music') || nameL.includes('audio') || nameL.includes('karaoke')) return PRODUCT_ICONS.music;

  // Sports
  if (catL === 'sports' || nameL.includes('ball') || nameL.includes('soccer') || nameL.includes('sports')) return PRODUCT_ICONS.ball;

  // Graphics
  if (catL === 'graphics' || nameL.includes('design') || nameL.includes('logo') || nameL.includes('banner')) return PRODUCT_ICONS.pen_tool;

  // Default
  return PRODUCT_ICONS.package;
}

// Helper function to enrich products with imageUrl
export function enrichProductsWithIcons(products: any[]): any[] {
  return products.map(p => ({
    ...p,
    imageUrl: p.imageUrl || getIconForProduct(p.name, p.category)
  }));
}
