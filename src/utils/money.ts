// Money formatting for phones this shop actually uses.
//
// Two things are wrong with the obvious `new Intl.NumberFormat('en-UG', ...)`
// inline at every call site:
// 1. It THROWS on a browser whose Intl data lacks the en-UG locale, and the
//    legacy bundle's floor is Chrome 49. This function formats every price,
//    total and balance on every screen, so a throw here is a blank till.
// 2. It builds a formatter per call, which is wasteful on a grid of products.
// So: build once, cache, and fall back through plainer formatters, ending at a
// hand-rolled grouping that cannot fail.

let cached: ((value: number) => string) | null = null;

function handRolled(value: number): string {
  const rounded = Math.round(Number(value) || 0);
  const negative = rounded < 0;
  const digits = String(Math.abs(rounded));
  let grouped = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ',';
    grouped += digits[i];
  }
  return `${negative ? '-' : ''}UGX ${grouped}`;
}

function buildFormatter(): (value: number) => string {
  // Preferred: the real thing, locale-aware.
  try {
    const fmt = new Intl.NumberFormat('en-UG', {
      style: 'currency', currency: 'UGX',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
    // Prove it works for an actual value: some builds construct fine and only
    // throw on first use, and a formatter that throws per call is the bug.
    const probe = fmt.format(1000);
    if (typeof probe === 'string' && probe.length) {
      return (value: number) => fmt.format(Number(value) || 0);
    }
  } catch { /* locale data missing — try the next shape */ }
  try {
    const fmt = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'UGX',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
    const probe = fmt.format(1000);
    if (typeof probe === 'string' && probe.length) {
      return (value: number) => fmt.format(Number(value) || 0);
    }
  } catch { /* no currency support at all — group it by hand */ }
  return handRolled;
}

export function formatUgx(value: number): string {
  if (!cached) cached = buildFormatter();
  try {
    return cached(value);
  } catch {
    // Last resort, and remember it so the broken formatter is not retried.
    cached = handRolled;
    return handRolled(value);
  }
}

// Test seam: forget the cached formatter so a new environment is probed.
export function resetCurrencyFormatter(): void {
  cached = null;
}
