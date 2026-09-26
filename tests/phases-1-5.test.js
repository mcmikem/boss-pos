import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const api = read('api/index.js');
const types = read('src/types.ts');
const register = read('src/components/CategoryRegister.tsx');
const dates = read('src/utils/dates.ts');
const app = read('src/App.tsx');

test('money destinations are neutral — no hardcoded owner name', () => {
  assert.equal(/Given to Owner \(Mike\)/.test(register), false);
  assert.equal(/McMike/.test(register), false);
  assert.equal(/McMike/.test(api), false);
  assert.match(register, /ownerName/);
  assert.match(register, /const ownerLabel = ownerName \? `Given to Owner \(\$\{ownerName\}\)` : 'Given to Owner';/);
  assert.match(register, /label: ownerLabel/);
});

test('handover can go to the owner OR a named manager', () => {
  assert.match(types, /'float' \| 'cash' \| 'owner' \| 'manager' \| 'bank'/);
  assert.match(api, /\['float', 'cash', 'owner', 'manager', 'bank'\]/);
  assert.match(register, /'manager' as const/);
  assert.match(register, /managerList/);
});

test('a manager handover must name its recipient', () => {
  assert.match(api, /RECIPIENT_REQUIRED/);
  assert.match(api, /recipientRole === 'manager' && !recipientId/);
});

test('receipt confirmation is recorded against the recipient', () => {
  assert.match(api, /money-handover\/pending/);
  assert.match(api, /money-handover\/:id\/confirm/);
  assert.match(api, /NOT_THE_RECIPIENT/);
  assert.match(api, /received_by_name/);
  assert.match(api, /handover\.received/);
  assert.match(api, /receipt_status = 'received'/);
});

test('the owner/manager gets a full-screen confirm prompt', () => {
  const prompt = read('src/components/HandoverPrompt.tsx');
  assert.match(prompt, /role="dialog"/);
  assert.match(prompt, /aria-modal="true"/);
  assert.match(prompt, /Confirm you received it/);
  assert.match(prompt, /Yes, I received/);
});

test('the money board reports float, owner, managers and awaiting confirmation', () => {
  assert.match(api, /money-handover\/summary/);
  assert.match(api, /awaitingConfirmation/);
  assert.match(api, /byRecipient/);
  const prompt = read('src/components/HandoverPrompt.tsx');
  assert.match(prompt, /Money so far/);
  assert.match(prompt, /still waiting to be confirmed/);
});

test('closing reminder is owner-configurable and lands on the sell screen', () => {
  assert.match(types, /closeReminderLeadMin/);
  assert.match(api, /'closeReminderLeadMin'/);
  assert.match(dates, /export function closeReminderState/);
  assert.match(dates, /export function minutesUntilClose/);
  assert.match(app, /<CloseReminderBar/);
  assert.match(app, /leadMinutes=\{settings\.closeReminderLeadMin\}/);
  const bar = read('src/components/CloseReminderBar.tsx');
  assert.match(bar, /Close day/);
  assert.match(bar, /aria-live="polite"/);
  assert.match(bar, /setInterval/);
});

test('reminder respects days off and overnight shifts', () => {
  const testFile = read('src/utils/dates.test.ts');
  assert.match(testFile, /day off/);
  assert.match(testFile, /overnight shifts/);
  assert.match(dates, /isShopDayOff\(hours, now\)/);
});

test('morning production is the first eatery screen', () => {
  const sales = read('src/components/Sales.tsx');
  assert.match(sales, /selectedCategory === 'Eatery' \|\| selectedCategory === 'Drinks'\) \{\s*\n\s*setShowProduction\(true\);/);
});

test('production loads recipe ingredients with editable prices', () => {
  const mp = read('src/components/MorningProduction.tsx');
  assert.match(mp, /Ingredients · edit if a price changed/);
  assert.match(mp, /Recipe total/);
  assert.match(mp, /costEachFromRecipe/);
  assert.match(mp, /Worked out from the ingredients above/);
});

test('production budget is shown and shortfalls are recorded, not hidden', () => {
  const mp = read('src/components/MorningProduction.tsx');
  assert.match(mp, /Ingredient money set aside/);
  assert.match(mp, /onRequestTopUp/);
  assert.match(mp, /Need more/);
  assert.match(app, /ingredientBudgetToday/);
  assert.match(app, /handleIngredientTopUp/);
});

test('set-aside ingredient money is never counted as profit', () => {
  const cashflow = read('src/utils/cashflow.ts');
  assert.match(cashflow, /keptForTomorrow/);
  assert.match(cashflow, /assigned = movedOut \+ closingCapital/);
  // A matching count must clear the nag even with unassigned money in the drawer.
  assert.match(cashflow, /Counted .* matches the expected/);
});

test('close day never hides the main action in a collapsed card', () => {
  assert.match(register, /money: true/);
  assert.match(register, /Record Money Out/);
  assert.match(register, /bg-cyan-500 hover:bg-cyan-400 text-black/);
});

test('reconciliation numbers are legible, not uniform small text', () => {
  assert.match(register, /hero \? 'text-xl sm:text-2xl'/);
  assert.match(register, /label="Expected in drawer" value=\{fmt\(expected\)\} hero/);
  assert.match(register, /hero\s*\n\s*tone=\{unassigned > 0\.5/);
});

test('handover history is separated from today', () => {
  assert.match(register, /Past moves \(\{pastTransfers\.length\}\) — not today/);
  assert.match(register, /Moved today/);
});

test('a manager profile without a manager credential gets a different, actionable warning', () => {
  const api = read('src/api.ts');
  const app = read('src/App.tsx');
  assert.match(api, /usedStaffToken: Boolean\(getStaffToken\(\)\)/);
  assert.match(app, /Manager profile, manager credential missing — enter the manager staff PIN again\./);
  assert.match(app, /label: managerProfile && !usedStaffToken \? 'Sign in' : 'Switch seller'/);
  assert.match(app, /setShowStaffSwitcher\(false\);\s*\n\s*fetchAllData\(\)\.catch\(\(\) => \{\}\);/);
});

test('background handover checks never raise the manager toast', () => {
  const api = read('src/api.ts');
  const app = read('src/App.tsx');
  assert.match(api, /silentManager\?: boolean/);
  assert.match(api, /MANAGER_REQUIRED' && !silentManager/);
  assert.match(api, /pending.*fresh: true, silentManager: true/s);
  assert.match(api, /money-handover\/summary.*fresh: true, silentManager: true/s);
  assert.match(app, /if \(authState !== 'ready' \|\| !isManager\) return;/);
});

test('manager-only polling waits until staff membership is actually known', () => {
  const app = read('src/App.tsx');
  assert.match(app, /const \[staffLoaded, setStaffLoaded\] = useState\(false\);/);
  assert.match(app, /const isManager = staffLoaded \? isManagerRole\(activeRole, staffConfigured\) : activeRole === 'manager';/);
  assert.match(app, /setStaffList\(list\); setStaffLoaded\(true\);/);
});

test('a rejected credit explains WHY, not just "failed"', () => {
  const app = read('src/App.tsx');
  assert.match(app, /creditSaveFailure/);
  assert.match(app, /SESSION_CLOSED/);
  assert.match(app, /reopen the day to change it/);
  assert.match(app, /CREDIT_LIMIT_EXCEEDED.*over their credit limit/s);
  assert.match(app, /TOTAL_MISMATCH/);
  assert.match(app, /A closed business day is a real, common cause/);
});

test('a slow 401 after unlock never bounces back to the PIN screen', () => {
  const api = read('src/api.ts');
  assert.match(api, /export function markUnlocked/);
  assert.match(api, /inUnlockGrace/);
  assert.match(api, /waitForTokenMint/);
  // The re-lock fires only when no credential looks usable, or the server
  // keeps rejecting live-looking ones — never on a single slow 401.
  assert.match(api, /const alive = pruneExpiredCredentials\(\);/);
  assert.match(api, /alive === 'none' \|\| consecutiveAuthFailures >= 2/);
  assert.match(api, /fail just this request, keep the session/);
});

test('every unlock path opens the grace window', () => {
  const app = read('src/App.tsx');
  const marks = app.match(/markUnlocked\(\)/g) || [];
  assert.ok(marks.length >= 3, `expected the local-hash, server and staff unlock paths, found ${marks.length}`);
});

test('close time is a reminder, never a lock on selling', () => {
  const src = read('api/index.js');
  // Current and future business dates must ALWAYS pass: a shop keeps trading
  // after its closing time all evening. Only a date before the branch's latest
  // already-reported closed day is refused.
  assert.match(src, /ORDER BY business_date DESC LIMIT 1/);
  assert.match(src, /if \(scope\.date >= rows\[0\]\.business_date\) return next\(\);/);
  assert.match(src, /A closed session is a RECORD of the close, not a lock on the till/);
  // Neither the exact-closed-date block nor the any-earlier-session block may
  // remain: both can brick current-day trading.
  assert.equal(/business_date=\$\{scope\.date\}/.test(src), false);
  assert.equal(/business_date < \$\{scope\.date\}/.test(src), false);
});

test('reopening a day also reopens it on the server', () => {
  const app = read('src/App.tsx');
  const register = read('src/components/CategoryRegister.tsx');
  assert.match(app, /handleReopenDay/);
  assert.match(app, /closeSessionApi\.reopen/);
  assert.match(app, /onReopenDay=\{handleReopenDay\}/);
  assert.match(register, /onReopenDay\?: \(\) => void \| Promise<void>/);
  assert.match(register, /if \(onReopenDay\) await onReopenDay\(\)/);
});

test('a manager stays a manager when the till PIN re-mints', () => {
  const api = read('src/api.ts');
  const app = read('src/App.tsx');
  // The staff credential gets its own slot so the till unlock cannot
  // overwrite the role the server authorises against.
  assert.match(api, /const STAFF_TOKEN_KEY = 'boss_pos_staff_token'/);
  assert.match(api, /export function setStaffToken/);
  assert.match(api, /getStaffToken\(\) \|\| getAuthToken\(\)/);
  assert.match(app, /if \(s\.token\) setStaffToken\(s\.token\)/);
  // Unlocking the till must never write to the staff slot.
  assert.equal(/setStaffToken\(s\.token\)[\s\S]{0,400}setStaffToken/.test(app), false);
});

test('logging out and auth failures clear both credentials', () => {
  const api = read('src/api.ts');
  assert.match(api, /export function clearAllTokens/);
  assert.match(api, /if \(pruneExpiredCredentials\(\) === 'none'\) \{/);
  assert.match(api, /Failed to log out all devices'\);\s*\n\s*clearAllTokens\(\)/);
});

test('a dead credential is proven by expiry, never guessed', () => {
  const api = read('src/api.ts');
  assert.match(api, /export function tokenExpired/);
  assert.match(api, /export function pruneExpiredCredentials/);
  assert.match(api, /boss-pos-staff-revoked/);
  assert.match(api, /consecutiveAuthFailures >= 2/);
  // The old guess — "the staff token is probably stale, drop it" — is gone.
  assert.equal(/likelier stale one/.test(api), false);
});

test('the till unlock cannot downgrade a signed-in manager', () => {
  const api = read('src/api.ts');
  const app = read('src/App.tsx');
  // authVerify (till PIN) writes ONLY the till slot; setAuthToken must never be
  // pointed at the staff slot, and the staff slot is what carries the role.
  const staffVerify = app.match(/staffApi\.verify[\s\S]{0,200}/)?.[0] || '';
  assert.match(staffVerify, /setStaffToken\(s\.token\)/);
  assert.equal(/staffApi\.verify[\s\S]{0,300}setAuthToken\(/.test(app), false);
  // A 401 drops the staff credential first and only re-locks when nothing is left.
  assert.match(api, /getStaffToken\(\) \|\| getAuthToken\(\)/);
});

test('closing a day files the owner summary automatically', () => {
  const register = read('src/components/CategoryRegister.tsx');
  const app = read('src/App.tsx');
  assert.match(register, /onCloseDayFinished\?: \(close: \{/);
  assert.match(register, /closeSummaryAuto !== false/);
  assert.match(register, /Close summary sent to the owner/);
  assert.match(register, /WhatsApp it/);
  assert.match(app, /handleCloseDayFinished/);
  assert.match(app, /closeSummaryApi\.send\(/);
  assert.match(app, /closeSummaryClientWriteId\(close\.businessDate, close\.branch\)/);
  assert.match(app, /recipientRole: 'owner'/);
  assert.match(app, /onCloseDayFinished=\{handleCloseDayFinished\}/);
});

test('the owner summary tells one story in-app and on WhatsApp', () => {
  const util = read('src/utils/closeSummary.ts');
  assert.match(util, /export function buildCloseSummaryPayload/);
  assert.match(util, /Expected in drawer/);
  assert.match(util, /Not yet assigned/);
  assert.match(util, /Counted:/);
  assert.match(util, /Closed by/);
});

test('owner and managers have an inbox with read state and WhatsApp share', () => {
  const app = read('src/App.tsx');
  const inbox = read('src/components/CloseSummaryInbox.tsx');
  assert.match(app, /closeSummaryApi\.inbox\(\)/);
  assert.match(app, /closeSummaryApi\.markRead\(/);
  assert.match(app, /closeSummaryApi\.markShared\(/);
  assert.match(app, /setShowSummaryInbox\(true\)/);
  assert.match(app, /unreadSummaries/);
  assert.match(inbox, /role="dialog"/);
  assert.match(inbox, /aria-modal="true"/);
  assert.match(inbox, /Close summaries/);
  assert.match(inbox, /WhatsApp/);
});

test('tomorrow is planned from recipes at close, not typed', () => {
  const register = read('src/components/CategoryRegister.tsx');
  const app = read('src/App.tsx');
  const api = read('api/index.js');
  assert.match(register, /Plan tomorrow/);
  assert.match(register, /Same as today/);
  assert.match(register, /Ingredient money needed/);
  assert.match(register, /Use a different amount \(optional override\)/);
  assert.match(register, /onCommitProductionPlan/);
  assert.match(register, /Committed: /);
  assert.match(app, /handleCommitProductionPlan/);
  assert.match(app, /productionPlanApi\.save\(/);
  assert.match(app, /eodCapital: \{ \.\.\.\(prev\.eodCapital \|\| \{\}\), \[plan\.category\]: saved\.total \}/);
  assert.match(api, /CREATE TABLE IF NOT EXISTS production_plans/);
  assert.match(api, /idx_production_plans_day/);
  assert.match(api, /app\.post\('\/api\/production-plans'/);
  assert.match(api, /app\.get\('\/api\/production-plans'/);
  assert.match(api, /app\.delete\('\/api\/production-plans\/:id'/);
});

test('the morning starts from the plan, and closed days stay immutable', () => {
  const sales = read('src/components/Sales.tsx');
  const morning = read('src/components/MorningProduction.tsx');
  const api = read('api/index.js');
  assert.match(sales, /productionPlanApi\.get\(todayLocalKey\(\)\)/);
  assert.match(sales, /plannedLines=\{plannedToday\}/);
  assert.match(morning, /Planned last evening — make these first/);
  assert.match(morning, /usePlannedLine/);
  assert.match(api, /Plans never touch close_sessions/);
  assert.match(api, /ON CONFLICT \(business_date, category, branch\) DO UPDATE/);
});

test('the design system rules every screen: one hero, one primary action, one vocabulary', () => {
  const kit = read('src/components/Design.tsx');
  assert.match(kit, /export function MoneyHero/);
  assert.match(kit, /export function MoneyStat/);
  assert.match(kit, /export function PrimaryAction/);
  assert.match(kit, /export const LABELS/);
  // Stock: money on shelves is the hero, the rest support it.
  const stock = read('src/components/Inventory.tsx');
  assert.match(stock, /<MoneyHero/);
  assert.match(stock, /LABELS\.moneyOnShelves/);
  assert.match(stock, /LABELS\.lowStock/);
  assert.match(stock, /LABELS\.notSelling/);
  // Expenses + Reports use the same heroes, not bespoke lookalikes.
  const expenses = read('src/components/Expenses.tsx');
  assert.match(expenses, /<MoneyHero/);
  assert.match(expenses, /<MoneyStat/);
  const reports = read('src/components/Analytics.tsx');
  assert.match(reports, /<MoneyHero/);
  assert.match(reports, /LABELS\.moneyIn/);
});

test('no screen speaks the old money language anymore', () => {
  const files = [
    'src/components/CategoryRegister.tsx',
    'src/components/Inventory.tsx',
    'src/components/Expenses.tsx',
    'src/components/Analytics.tsx',
    'src/components/Sales.tsx',
    'src/components/Dashboard.tsx',
    'src/components/MorningProduction.tsx',
  ].map(read);
  for (const source of files) {
    assert.doesNotMatch(source, /Left to move/);
    assert.doesNotMatch(source, /still out/i);
    assert.doesNotMatch(source, /accounted for/i);
    assert.doesNotMatch(source, /Collected today/);
    assert.doesNotMatch(source, /NOT moved/);
    assert.doesNotMatch(source, /FLAG for review/);
  }
});

test('a close that missed its summary retries it on the next visit', () => {
  const register = read('src/components/CategoryRegister.tsx');
  assert.match(register, /summaryRetried/);
  assert.match(register, /if \(!dayClosedAt \|\| summarySentId\) return;/);
  assert.match(register, /revisiting a closed day with no filed summary retries/);
});

test('sales get their own ledger first, with time and area filters', () => {
  const ledger = read('src/components/SalesLedger.tsx');
  assert.match(ledger, /Today/);
  assert.match(ledger, /Yesterday/);
  assert.match(ledger, /This week/);
  assert.match(ledger, /This month/);
  assert.match(ledger, /Business area/);
  assert.match(ledger, /Biggest/);
  assert.match(ledger, /Waiting for your approval/);
  assert.match(ledger, /Ask to fix/);
  assert.match(ledger, /My requests/);
  const analytics = read('src/components/Analytics.tsx');
  assert.match(analytics, /<SalesLedger/);
  assert.match(analytics, />Sales</);
});

test('a cashier can ask, only a manager can apply', () => {
  const ledger = read('src/components/SalesLedger.tsx');
  assert.match(ledger, /Nothing changes until a manager approves it/);
  assert.match(ledger, /saleChangeApi\.create\(/);
  assert.match(ledger, /saleChangeApi\.approve\(/);
  assert.match(ledger, /saleChangeApi\.reject\(/);
  assert.match(ledger, /Say why — the manager needs a reason/);
  const api = read('src/api.ts');
  assert.match(api, /saleChangeApi = \{/);
  assert.match(api, /\/api\/sale-change-requests/);
});

test('the Reports tab is now the Sales tab', () => {
  const app = read('src/App.tsx');
  assert.match(app, /t\(settings\.language, 'salesTab'\)/);
  assert.match(app, /id="analytics-nav-btn"/);
  const i18n = read('src/utils/i18n.ts');
  assert.match(i18n, /salesTab: 'Sales'/);
});

test('fresh receipts close by themselves; reprints stay open', () => {
  const modal = read('src/components/ReceiptModal.tsx');
  const sales = read('src/components/Sales.tsx');
  assert.match(modal, /autoCloseMs\?: number/);
  assert.match(modal, /Closes on its own — touch to keep it open/);
  assert.match(sales, /receiptFresh/);
  assert.match(sales, /autoCloseMs=\{receiptFresh \? 3000 : undefined\}/);
});

test('receipts keep their design as pixels, with the shop logo', () => {
  const modal = read('src/components/ReceiptModal.tsx');
  const app = read('src/App.tsx');
  assert.match(modal, /renderReceiptPng/);
  assert.match(modal, /receiptLogoUrl/);
  assert.match(modal, /PNG/);
  assert.match(app, /receiptLogoUrl/);
  assert.match(app, /Add receipt logo/);
  const api = read('api/index.js');
  assert.match(api, /'receiptLogoUrl', 'communityGroupUrl',/);
});

test('the sell search owns its own full line on small phones', () => {
  const sales = read('src/components/Sales.tsx');
  assert.match(sales, /relative w-full sm:w-auto sm:flex-1 sm:min-w-0/);
  assert.doesNotMatch(sales, /flex-nowrap gap-1\.5 items-center/);
});

test('regulars can be invited to the shoppers group; numbers copy out for broadcast', () => {
  const customers = read('src/components/Customers.tsx');
  const app = read('src/App.tsx');
  assert.match(customers, /groupInviteUrl\?: string/);
  assert.match(customers, /Invite .* to the shoppers' group/);
  assert.match(customers, /Copy numbers/);
  assert.match(read('src/components/Sales.tsx'), /groupInviteUrl=\{settings\?\.communityGroupUrl/);
  assert.match(app, /communityGroupUrl/);
  assert.match(app, /Customer community/);
});

test('every release gets a smoke test and a phone checklist', () => {
  assert.ok(read('scripts/smoke-prod.mjs').includes('/api/ready'));
  assert.ok(read('scripts/smoke-prod.mjs').includes('process.exit(1)'));
  assert.match(JSON.parse(read('package.json')).scripts.smoke, /smoke-prod/);
  const qa = read('QA.md');
  assert.match(qa, /Device matrix/);
  assert.match(qa, /Street mode/);
  assert.match(qa, /Ask to fix/);
  assert.match(qa, /Airplane mode/);
});

test('a signed-in manager sees unclaimed owner handovers, not just named ones', () => {
  const api = read('api/index.js');
  assert.match(api, /recipient_id IS NULL AND to_type IN \('owner', 'manager'\)/);
  assert.match(api, /unclaimed owner\/manager handovers/);
});
