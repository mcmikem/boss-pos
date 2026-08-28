const KEY = 'boss_pos_price_history';
export interface PriceChange { productId: string; name: string; oldPrice: number; newPrice: number; at: string; by: string; }
export function logPriceChange(productId: string, name: string, oldPrice: number, newPrice: number) {
  if (oldPrice === newPrice) return;
  try {
    const arr: PriceChange[] = JSON.parse(localStorage.getItem(KEY) || '[]');
    arr.unshift({ productId, name, oldPrice, newPrice, at: new Date().toISOString(), by: localStorage.getItem('boss_pos_staff') || '' });
    localStorage.setItem(KEY, JSON.stringify(arr.slice(0, 200)));
  } catch {}
}
export function getPriceHistory(productId?: string): PriceChange[] {
  try {
    const arr: PriceChange[] = JSON.parse(localStorage.getItem(KEY) || '[]');
    return productId ? arr.filter(x=>x.productId===productId) : arr;
  } catch { return []; }
}
