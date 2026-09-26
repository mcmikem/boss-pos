// The close summary is the owner's evening briefing: what was taken, where
// the cash physically is, what still needs a decision, and whether the count
// matched. One shape feeds the in-app inbox AND the WhatsApp share, so the
// owner never gets two different stories.
export interface CloseSummaryInput {
  shopName: string;
  businessDate: string; // YYYY-MM-DD
  branch: string; // department closed, or '' for the whole shop
  tookToday: number;
  cashSales: number;
  phoneSales: number;
  openingFloat: number;
  drawerExpenses: number;
  expectedInDrawer: number;
  assigned: number;
  unassigned: number;
  counted: number | null;
  variance: number | null;
  creditGivenOut: number;
  creditCollectedBack: number;
  awaitingHandover: number; // UGX handed to a person, not yet confirmed
  closedByName: string;
  ownerName?: string;
}

export interface CloseSummaryPayload {
  headline: string;
  body: string;
  totals: Record<string, number>;
}

const n = (v: number) => Math.round(v || 0).toLocaleString();

export function buildCloseSummaryPayload(input: CloseSummaryInput): CloseSummaryPayload {
  const who = input.branch ? `${input.shopName} · ${input.branch}` : input.shopName;
  const countedLine = input.counted == null
    ? 'Counted: not yet counted'
    : `Counted: ${n(input.counted)} · Difference: ${input.variance === 0 ? '✓ 0' : `${input.variance! > 0 ? '+' : '−'}${n(Math.abs(input.variance!))}`}`;
  const headline = `Close ${input.businessDate} — ${who}: took ${n(input.tookToday)}`;
  const lines = [
    `${who} · close of ${input.businessDate}`,
    `Took today: ${n(input.tookToday)} (cash ${n(input.cashSales)} · phone ${n(input.phoneSales)})`,
    `Expected in drawer: ${n(input.expectedInDrawer)} (opening ${n(input.openingFloat)} − expenses ${n(input.drawerExpenses)})`,
    `Assigned: ${n(input.assigned)} · Not yet assigned: ${input.unassigned > 0.5 ? n(input.unassigned) : 'none'}`,
    countedLine,
  ];
  if (input.creditGivenOut > 0 || input.creditCollectedBack > 0) {
    lines.push(`Credit: ${n(input.creditGivenOut)} given out · ${n(input.creditCollectedBack)} collected back`);
  }
  if (input.awaitingHandover > 0.5) {
    lines.push(`Handed to a person, awaiting confirmation: ${n(input.awaitingHandover)}`);
  }
  lines.push(`Closed by ${input.closedByName || 'the till'}`);
  return {
    headline,
    body: lines.join('\n'),
    totals: {
      tookToday: Math.round(input.tookToday),
      cashSales: Math.round(input.cashSales),
      phoneSales: Math.round(input.phoneSales),
      openingFloat: Math.round(input.openingFloat),
      drawerExpenses: Math.round(input.drawerExpenses),
      expectedInDrawer: Math.round(input.expectedInDrawer),
      assigned: Math.round(input.assigned),
      unassigned: Math.round(input.unassigned),
      counted: input.counted == null ? 0 : Math.round(input.counted),
      variance: input.variance == null ? 0 : Math.round(input.variance),
      creditGivenOut: Math.round(input.creditGivenOut),
      creditCollectedBack: Math.round(input.creditCollectedBack),
      awaitingHandover: Math.round(input.awaitingHandover),
    },
  };
}

export function closeSummaryClientWriteId(businessDate: string, branch: string): string {
  return `close-summary:${businessDate}:${branch || 'shop'}`;
}
