// Which categories actually MAKE goods fresh each morning with daily
// input/capital (flour, oil, charcoal for Eatery; passion fruits, pineapples,
// sugar for fresh Drinks like Obutunda & Omunanansi)? Only those get "Daily
// production" and the made-sold-lost balance in Registers. Buy-resell
// (Electronics, Stationery, …) and make-to-order (Tailoring, Graphics, …)
// must never show them — inviting a "production" entry for a phone charger
// or a suit is how nonsense data starts.
// NOTE: depot sodas (Coca-Cola, Mirinda, Rock Boom…) inside Drinks are
// buy-resell — only the fresh-juice lines are made. The Registers hint below
// says so, so nobody logs "production" for a crate of Coke.

export const DAILY_MAKE_CATEGORIES = ['Eatery', 'Drinks'];

export function isDailyMakeCategory(cat: string): boolean {
  return DAILY_MAKE_CATEGORIES.includes((cat || '').trim());
}

// Where the real workflow lives for non-daily categories. Shown as a hint
// in Registers so each section matches how that business actually runs.
export const CATEGORY_WORKFLOW_HINT: Record<string, string> = {
  Tailoring: 'Orders and customer payments are tracked here.',
  Graphics: 'Track jobs, payments and work still pending here.',
  Printing: 'Track jobs, payments and work still pending here.',
  Electronics: 'Track products, stock and money here.',
  Stationery: 'Track products, stock and money here.',
  Library: 'Track products, stock and money here.',
  Sports: 'Track products, stock and money here.',
  Drinks: 'Track products, stock and money here.',
};
