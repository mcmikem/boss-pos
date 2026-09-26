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
- [ ] Seller's own staff PIN unlocks the till AND signs them in (one PIN, no second prompt)
- [ ] Rescue (shop) PIN unlocks the device but shows TILL — no manager rights, no leftover manager token
- [ ] A PIN shared by two people asks "Who is this?" and issues no token until answered
- [ ] Wrong PIN 5× → 30s lockout, then works again.
- [ ] Idle past the lock delay → PIN screen, no data lost, queued work syncs after unlock.
- [ ] Manager-only action as cashier → clear "sign in as manager" prompt.
- [ ] "Log out all devices" → other phones re-lock on next action.

## Offline
- [ ] Airplane mode: sell → receipt says queued; close/reopen app → sale intact.
- [ ] Reconnect → "Back online — N sales sent", sale lands in Sales + money.

## Seller can-do list (regressions from the June audit)

Every item below used to be refused by the server or announced before it was
saved. Test each as a CASHIER unless the line says manager. A failure must
never say "saved" and then lose the entry — that is the whole point of the list.

### Selling
- [ ] Ring up a sale, then Undo inside 10s → the sale is refunded and stock returns.
- [ ] Undo someone else's sale (or one older than 60s) → refused with a clear reason.
- [ ] Custom item: name + price → it is added to the cart AND appears in the library
- [ ] Sell the custom item → completes (this used to fail with "Product not found")
- [ ] Price ending in .50, e.g. 3 × 1,500.50 → checkout completes.
- [ ] Move money between two drawers (Sell → ⋯ → Move money) → saves, and the amount stays if refused.

### Kitchen (Sell → Eatery/Drinks → Morning Production)
- [ ] Save a batch with a recipe → the batch appears under "Made today".
- [ ] With "Record ingredient expense" on → the expense lands in Expenses with the same amount.
- [ ] Type what you paid for an ingredient → tomorrow's cost follows (ask a manager to confirm on the Recipes screen).
- [ ] Save a batch the server refuses → the form KEEPS what was typed and says why.

### Expenses tab
- [ ] Log an expense → saved, and it survives a restart.
- [ ] Log one in a brand-new category (e.g. "Fuel") → saved; the category is registered.
- [ ] Mistype one ("Utilites") → refused with "Did you mean Utilities?".
- [ ] Delete a mistyped expense → the row goes and stays gone.
- [ ] As manager: Expenses list loads for a seller too (no "check connection" error).

### Close day
- [ ] Record Money Out → Phone float / Kept in drawer / Cash to owner / Cash to manager, with no reference demanded.
- [ ] Delete a money-moved row → the row stays deleted.
- [ ] "Tomorrow's opening" (float) as a cashier → it survives a restart on the server.
- [ ] Log a loss → "Loss logged" only AFTER the server has it; a refusal keeps the form.
- [ ] Confirm tray count (recount) → the old count is REPLACED, never duplicated.
- [ ] Delete a loss entry as a cashier → works.
- [ ] Add a credit to the book → saved; the form keeps what was typed if refused.
- [ ] Collect a payment on a credit → saved from Close day AND from the Sales ledger.
- [ ] Close the day → the owner summary says either "sent" or "NOT sent — <reason>".

### Still to confirm from earlier in this work
- [ ] Receipt auto-closes after 3s on a fresh sale, and stays open once touched.
- [ ] Variant tap (Big/Small) does not close the sheet.
- [ ] Manager handover notification reaches the named manager's phone.
- [ ] Yawe's old Android: app opens, sells, and syncs on a weak connection.

## Failure to report back
Exact toast text + which phone + build number + what you tapped. Settings →
Support → Copy support details attaches the server build, the last five lock
causes and who is signed in, so paste that with the report. The lock screen
itself shows only the most recent cause.
