// Which categories actually MAKE goods fresh each morning with daily
// input/capital (flour, oil, charcoal for Eatery)? Only those get "Daily
// production" and the made-sold-lost balance in Registers. Buy-resell
// (Electronics, Stationery, …) and make-to-order (Tailoring, Graphics, …)
// must never show them — inviting a "production" entry for a phone charger
// or a suit is how nonsense data starts.

export const DAILY_MAKE_CATEGORIES = ['Eatery'];

export function isDailyMakeCategory(cat: string): boolean {
  return DAILY_MAKE_CATEGORIES.includes((cat || '').trim());
}

// Where the real workflow lives for non-daily categories. Shown as a hint
// in Registers so each section matches how that business actually runs.
export const CATEGORY_WORKFLOW_HINT: Record<string, string> = {
  Tailoring: 'Make-to-order: deposits & pickups live in Sell → Tailoring → Manage Tailor Orders.',
  Graphics: 'Make-to-order: job pipeline lives in Sell → Graphics → Manage Design & Print Orders.',
  Printing: 'Make-to-order: job pipeline lives in Sell → Graphics → Manage Design & Print Orders.',
  Electronics: 'Buy-resell: top up stock in Stock; log breakages as losses below.',
  Stationery: 'Buy-resell: top up stock in Stock; log damages as losses below.',
  Library: 'Buy-resell: top up stock in Stock; log damages as losses below.',
  Sports: 'Buy-resell: top up stock in Stock; log damages as losses below.',
};
