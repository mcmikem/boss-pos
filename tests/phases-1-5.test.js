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
  // The re-lock must only fire once NO credential is actually in place.
  assert.match(api, /else if \(!getAuthToken\(\)\) \{\s*\n\s*clearAllTokens\(\);\s*\n\s*emitAuthRevoked/);
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
  assert.match(api, /if \(sawAuthFailure\) \{\s*\n\s*clearAllTokens\(\)/);
  assert.match(api, /Failed to log out all devices'\);\s*\n\s*clearAllTokens\(\)/);
});

test('a stale staff token falls back to the till token, not a re-lock', () => {
  const api = read('src/api.ts');
  assert.match(api, /if \(getStaffToken\(\) && getAuthToken\(\)\) \{/);
  assert.match(api, /fall back to the till token rather than re-locking the device/);
  assert.match(api, /setStaffToken\(null\);/);
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
