// Till control: every ambient behavior in the app has a master switch in
// Settings so each shop keeps only what works for them. Everything defaults
// ON (missing key = on) — shops opt out, never opt in. The map syncs to all
// tills through the normal settings sync.
export type FeatureKey =
  | 'fastSellers'
  | 'quickCash'
  | 'briefing'
  | 'setupChecklist'
  | 'closeWizard'
  | 'autoTools';

export const FEATURES: { key: FeatureKey; label: string; hint: string }[] = [
  { key: 'fastSellers', label: 'Fast sellers', hint: 'Star products + one-tap strip on Sell' },
  { key: 'quickCash', label: 'Quick cash keys', hint: 'Exact + bill shortcuts in the cart' },
  { key: 'briefing', label: 'Morning briefing', hint: 'Today at a glance on Sell' },
  { key: 'setupChecklist', label: 'Setup checklist', hint: 'Get-set-up card for new tills' },
  { key: 'closeWizard', label: 'Close-day steps', hint: 'Tick-off ritual on the Close tab' },
  { key: 'autoTools', label: 'Auto trade tools', hint: 'Tailor/design screens appear with stock' },
];

export function isOn(features: Record<string, boolean> | undefined, key: FeatureKey): boolean {
  return features?.[key] !== false;
}
