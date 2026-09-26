# Release QA — phone checklist

Run this on a real phone after every production deploy, before telling the
shop it is safe. Automated half: `npm run smoke` (add
`EXPECT_BUILD=<sha>` to pin the build). This file is the human half.

Device matrix: the manager's phone + the oldest Android in the shop (today:
Yawe's). A pass means the exact expected result below, not "looks fine".

## Update
- [ ] Settings → Update app → footer reads the new build number.
- [ ] Force-close and reopen — no white screen, no stuck loader.

## Sell
- [ ] Tap a product → "Added: …" toast, cart count rises.
- [ ] Tap a chapati-style variant → size picker opens; tap a size → "… added" toast, cart rises.
- [ ] Tap a sold-out product → out-of-stock message with Restock/Sell-custom, never silence.
- [ ] Complete sale → confirmation → receipt appears → receipt closes by itself in ~3s.
- [ ] Touch the receipt (tap Print/PNG/WA) → it stays open.
- [ ] Street mode: 3 rapid taps → 3 sales, no blocking modal, street counter rises.

## Receipt
- [ ] PNG button → image shares/saves with shop name, items, total, logo.
- [ ] Print → designed receipt (logo if set); Save as PDF works from the dialog.
- [ ] Reprint from ⋯ menu → receipt stays open (no auto-close).

## Money in/out
- [ ] Record Money Out → Float / Owner / Manager (manager picker appears) / Bank.
- [ ] Handover to a person → "Waiting for confirmation"; their phone shows the full-screen confirm; confirming records name + time.
- [ ] Money board shows float / owner / manager / banked / awaiting totals.

## Credit (Ababanjibwa Sente)
- [ ] Add credit → appears immediately; a rejection names the reason (cap, closed books, no connection).
- [ ] Record payment → balance drops; overpayment is refused with the outstanding figure.

## Close day
- [ ] Count drawer → Difference live; matching count clears warnings.
- [ ] Close day → "Summary sent to the owner" (or honest "will send on next sync").
- [ ] Owner/manager phone: mail icon badge → briefing popup with the same figures.
- [ ] WhatsApp it → prefilled message opens.
- [ ] Reminder bar appears 45 min (or as configured) before close time; dismiss works.

## Sales ledger (Sales tab, first section)
- [ ] Today / Yesterday / This week / This month + area chips + Biggest sort filter correctly.
- [ ] Cashier: "Ask to fix" → quantities/reason → "Sent to a manager".
- [ ] Manager: approval queue shows the request → Approve applies it (stock moves, totals change) → cashier sees Done.
- [ ] Turn down → cashier sees Turned down; sale untouched.

## Lock & roles
- [ ] Wrong PIN 5× → 30s lockout, then works again.
- [ ] Idle past the lock delay → PIN screen, no data lost, queued work syncs after unlock.
- [ ] Manager-only action as cashier → clear "sign in as manager" prompt.
- [ ] "Log out all devices" → other phones re-lock on next action.

## Offline
- [ ] Airplane mode: sell → receipt says queued; close/reopen app → sale intact.
- [ ] Reconnect → "Back online — N sales sent", sale lands in Sales + money.

## Failure to report back
Exact toast text + which phone + build number + what you tapped. The lock
screen shows the last lock cause; Settings → Support → Copy support details
attaches it to the report.
