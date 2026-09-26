import type { Sale } from '../types';

// A voided (deleted) sale is kept in the database as an audit trail, exactly
// like a refunded one. Both are dead for money purposes: neither may appear
// in revenue, takings, close-out, credit, loyalty, stock-expectation or any
// other live computation. Use these two predicates everywhere instead of
// hand-rolled `!s.refunded` checks, which silently resurrect voided rows.
export function isVoidedSale(s: { voided?: Sale['voided'] } | null | undefined): boolean {
  return !!s?.voided;
}

export function isLiveSale(
  s: { refunded?: Sale['refunded']; voided?: Sale['voided'] } | null | undefined,
): boolean {
  return !!s && !s.refunded && !s.voided;
}
