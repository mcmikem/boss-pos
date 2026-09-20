// Service sales (tailoring / design / repair / booking handovers + deposits)
// have synthetic productIds with no catalog row. Without this map every one
// of them lands in Reports as "Other"/"Unknown" and the trade disappears
// from category breakdowns and top-product lists.
export const SERVICE_PRODUCT_CATEGORIES: Record<string, string> = {
  'tailor-service': 'Tailoring',
  'design-service': 'Graphics',
  'repair-service': 'Repairs',
  'booking-service': 'Bookings',
};

export function serviceCategoryOf(productId: string): string | undefined {
  return SERVICE_PRODUCT_CATEGORIES[productId];
}
