import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(resolve(root, file), 'utf8');

test('viewport leaves browser zoom available', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /maximum-scale|user-scalable\s*=\s*no/i);
  assert.match(html, /name="viewport"[^>]+width=device-width/);
});

test('global motion, focus, and forced-colors rules exist', () => {
  const css = read('src/index.css');
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /forced-color-adjust/);
});

test('dialog surfaces expose names and focus management', () => {
  for (const file of [
    'src/components/Sheet.tsx',
    'src/components/KeyboardShortcuts.tsx',
    'src/components/NotificationsBell.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /role="dialog"/);
    assert.match(source, /aria-modal/);
    assert.match(source, /aria-label(?:ledby)?/);
    assert.match(source, /useDialogFocus/);
  }
  assert.match(read('src/components/Sheet.tsx'), /Escape/);
  const sales = read('src/components/Sales.tsx');
  assert.match(sales, /role="dialog"/);
  assert.match(sales, /aria-modal/);
  assert.match(sales, /aria-label(?:ledby)?/);
});

test('toast and notification changes are announced', () => {
  assert.match(read('src/components/Toast.tsx'), /aria-live/);
  assert.match(read('src/components/NotificationsBell.tsx'), /aria-live/);
});

test('sold-out catalog taps always explain the next action', () => {
  const sales = read('src/components/Sales.tsx');
  assert.match(sales, /onOutOfStock=\{handleOutOfStock\}/);
  assert.equal((sales.match(/onOutOfStock=\{handleOutOfStock\}/g) || []).length >= 2, true);
});

test('variant taps cannot be swallowed by the backdrop before the click', () => {
  const sales = read('src/components/Sales.tsx');
  assert.match(sales, /onMouseDown=\{\(event\) => \{ if \(event\.target === event\.currentTarget\) setVariantProduct\(null\); \}\}/);
  assert.doesNotMatch(sales, /onMouseDown=\{\(\) => setVariantProduct\(null\)\}/);
});

test('barcode scanner is split from the initial Sales import', () => {
  const sales = read('src/components/Sales.tsx');
  assert.match(sales, /lazyRetry\(\(\) => import\('\.\/BarcodeScanner'\)\)/);
  assert.doesNotMatch(sales, /import BarcodeScanner from/);
  assert.match(sales, /<Suspense/);
});

test('service worker has one manual registration and legacy-safe build policy', () => {
  const main = read('src/main.tsx');
  const vite = read('vite.config.ts');
  assert.equal((main.match(/navigator\.serviceWorker\.register\(/g) || []).length, 1);
  assert.match(main, /controllerchange/);
  assert.match(vite, /injectRegister:\s*false/);
  assert.match(vite, /strategies:\s*'generateSW'/);
  assert.match(vite, /inlineWorkboxRuntime:\s*true/);
  assert.match(vite, /downlevelServiceWorker/);
  assert.match(vite, /cleanupOutdatedCaches:\s*true/);
});

test('package and focused guard exist', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.match(packageJson.scripts.build, /npm run budget/);
  assert.equal(packageJson.scripts.budget, 'node scripts/check-build-budget.mjs');
  assert.ok(existsSync(resolve(root, 'scripts/check-build-budget.mjs')));
  assert.ok(existsSync(resolve(root, 'tests/frontend-upgrades.test.js')));
});

// A custom item rung at the till is posted as a sale LINE BY PRODUCT ID. If the
// cart line carries an id the products table never saw, the server refuses the
// whole sale with UNKNOWN_PRODUCT and the cashier sees "Product not found".
test('a custom item is saved to the library BEFORE it is put in the cart, with one id', () => {
  const modal = read('src/components/CustomChargeModal.tsx');
  const app = read('src/App.tsx');
  // Library first, cart second, and the cart line is the CANONICAL product the
  // save resolved with — never the throwaway draft.
  assert.match(modal, /const saved = onSave \? await onSave\(newProduct\) : newProduct;/);
  assert.match(modal, /onAdd\(saved \|\| newProduct\);/);
  assert.ok(
    modal.indexOf('await onSave(') < modal.indexOf('onAdd(saved'),
    'the library save must complete before the cart line exists',
  );
  // One id, minted in the canonical product shape (never a "custom-<ts>" id).
  assert.match(modal, /id: newLibraryProductId\(\)/);
  assert.match(modal, /`p-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2, 7\)\}`/);
  assert.doesNotMatch(modal, /custom-\$\{Date\.now\(\)\}/);
  // The save returns the canonical product and reuses the caller's id.
  assert.match(app, /const handleSaveCustomProduct = async \(custom: Product\): Promise<Product>/);
  assert.match(app, /return existing;/);
  assert.match(app, /id: custom\.id \|\|/);
});

test('a custom sale survives a product row the server has never seen', () => {
  const server = read('api/index.js');
  // Absent row -> registered as a service from the line's own name and price.
  assert.match(server, /const missingIds = productIds\.filter\(\(productId\) => !productMap\.has\(productId\)\)/);
  assert.match(server, /INSERT INTO products \(id,name,category,cost,price,stockqty,lowstockthreshold,isservice,updated_at\)/);
  // A deliberately deleted product is still refused.
  assert.match(server, /return !product \|\| product\.deleted;/);
});

test('a seller can register their own custom item, but stock lines stay manager-only', () => {
  const server = read('api/index.js');
  assert.match(server, /function isTillServiceLine\(p = \{\}\)/);
  assert.match(server, /app\.post\('\/api\/products', requireManagerForCatalogItem/);
  // Identity, stock and recipes are never in a till-made service line.
  assert.match(server, /!text\(p\.barcode, 60\)/);
  assert.match(server, /!text\(p\.imei, 60\)/);
  assert.match(server, /!p\.recipe/);
  // Stock-bearing catalog writes keep the manager gate.
  assert.match(server, /app\.put\('\/api\/products\/:id', requireManager/);
  assert.match(server, /app\.delete\('\/api\/products\/:id', requireManager/);
});

test('moving money out needs a manager session, and a refusal never eats the amounts', () => {
  const register = read('src/components/CategoryRegister.tsx');
  const app = read('src/App.tsx');
  // The form cannot even open without a manager credential.
  assert.match(register, /canManageMoneyOut = true/);
  assert.match(register, /if \(!canManageMoneyOut\) \{/);
  assert.match(register, /onRequestManagerSignIn\?\.\(\);/);
  // The save resolves false when refused, and the form keeps what was typed.
  assert.match(register, /saved = await onAddMomoTransfer\(/);
  assert.match(register, /if \(saved === false\) return;/);
  assert.ok(
    register.indexOf('if (saved === false) return;') < register.indexOf('setMomoAmount(\'\');'),
    'amounts may only be cleared once the server confirmed',
  );
  // The manager refusal is explained and offers the sign-in that fixes it.
  assert.match(app, /Only a manager can move money out — sign in with your staff PIN/);
  assert.match(app, /label: 'Sign in',\n\s*onClick: \(\) => \{ setStaffVerifyError\(null\); setShowStaffSwitcher\(true\); \}/);
  // A shop with no staff accounts is owner-run: the till is the manager there,
  // exactly as the server decides it.
  assert.match(app, /canManageMoneyOut=\{isManager\}/);
  // A list we were not allowed to read is never shown as a day with no moves.
  assert.match(app, /moneyOutBlocked=\{moneyOutBlocked\}/);
  assert.match(register, /moneyOutBlocked && \(/);
});

test('the close time is a reminder, never a lock on selling or on money out', () => {
  const server = read('api/index.js');
  const register = read('src/components/CategoryRegister.tsx');
  // The server knows the shop's hours only as a setting it stores — it never
  // reads them to refuse a write.
  assert.equal((server.match(/closeTime/g) || []).length, 1);
  assert.match(server, /'openTime', 'closeTime', 'closedDays'/);
  // The client flag only arms the close-out verdicts.
  assert.equal(/pastClose/.test(register.match(/handleSubmitMomo[\s\S]*?\n  \};/)[0] || ''), false);
  assert.match(register, /buildTheftFlags\(\{/);
});

test('cash money-out never demands a mobile-money reference', () => {
  const server = read('api/index.js');
  const rules = read('api/operationsBusiness.js');
  const register = read('src/components/CategoryRegister.tsx');
  // A reference is proof a phone transaction happened — optional everywhere,
  // still format-checked and still unique when it IS given.
  assert.match(rules, /export function validateReference\(value, field = 'reference', \{ required = true \} = \{\}\)/);
  assert.match(rules, /return required \? \{ error: `\$\{field\} is required`/);
  assert.match(server, /validateReference\(t\.reference, 'MoMo reference', \{ required: false \}\)/);
  // Rows without a reference must not collide with each other.
  assert.match(server, /if \(referenceResult\.value\) \{\n\s+const duplicateReference = await sql`SELECT id,status FROM momo_transfers WHERE reference=/);
  // And the form asks for it in plain words, with cash as the default answer.
  assert.match(register, /Mobile money reference/);
  assert.match(register, /Mobile money reference \(optional\)/);
  assert.match(register, /momoReference\.trim\(\) \? \{ reference: momoReference\.trim\(\)\.slice\(0, 120\) \} : \{\}/);
});

test('there is no phone-only PIN pretending to be a manager', () => {
  const app = read('src/App.tsx');
  const gate = read('src/components/PinGate.tsx');
  // Manager authority is the signed-in staff account, checked by the server.
  // A local 4-digit PIN cannot authorise anything, so it is never collected.
  const requirePin = app.match(/const requirePin = [\s\S]*?\n  \};/)[0];
  assert.equal(/boss_pos_manager_pin/.test(requirePin), false);
  assert.equal(/promptDialog\(\{ title: 'Manager PIN'/.test(app), false);
  assert.match(requirePin, /Only a manager can do this — sign in with a manager staff PIN/);
  // The old key is no longer offered anywhere; boot drops the leftover value so
  // a dead secret does not sit on a device looking like it still grants rights.
  assert.equal(/localStorage\.setItem\('boss_pos_manager_pin'/.test(app), false);
  assert.match(app, /localStorage\.removeItem\('boss_pos_manager_pin'\)/);
  assert.equal(/boss_pos_manager_pin/.test(gate), false);
  // The top bar says who this phone is signed in as, on phones too.
  assert.match(app, /\{isManager \? 'MGR' : activeStaff \? 'CSH' : 'TILL'\}/);
  assert.match(app, /canManageMoneyOut=\{isManager\}/);
});

test('money coming IN is a till action, and a refused write always says why', () => {
  const server = read('api/index.js');
  const app = read('src/App.tsx');
  // Collecting a debt is the seller handing over cash, not a manager decision.
  assert.match(server, /app\.post\('\/api\/credit-payments', asHandler\(handleCreditPaymentCreate\)\)/);
  // Crediting it to somebody else's name still is one.
  assert.match(server, /Only a manager can record another collector/);
  // Credit limits stay manager-only.
  assert.match(server, /Only a manager can override a credit limit/);
  // No bare "failed to sync" anywhere: every catch names the cause.
  assert.equal(/Failed to sync payment to server/.test(app), false);
  const reasons = app.match(/const paymentSaveFailure = [\s\S]*?\n  \};/)?.[0] || '';
  for (const code of ['SESSION_CLOSED', 'MANAGER_REQUIRED', 'SALE_NOT_FOUND', 'OVERPAYMENT']) {
    assert.match(reasons, new RegExp(code));
  }
  assert.match(reasons, /No connection — the payment is queued/);
  // The credit-add path names its causes too, including the silent-server case.
  const credit = app.match(/const creditSaveFailure = [\s\S]*?\n  \};/)?.[0] || '';
  assert.match(credit, /CREDIT_RECORD_NOT_SAVED/);
  assert.match(credit, /tell the manager/);
});

test('one PIN per person: the lock screen asks whose PIN it is', () => {
  const server = read('api/index.js');
  const api = read('src/api.ts');
  const app = read('src/App.tsx');
  const gate = read('src/components/PinGate.tsx');
  // Pre-auth, rate limited exactly like the seller switcher, and it answers
  // with the person AND their role token.
  const unlock = server.match(/app\.post\('\/api\/staff\/unlock'[\s\S]*?\n\}\)\);/)?.[0] || '';
  assert.match(unlock, /'staff:' \+ attemptKey\(clientIp\(req\)\)/);
  assert.match(unlock, /LOCKOUT_FAILURES/);
  assert.match(unlock, /verifyStoredPin\(row\.pin_hash, pin\)/);
  assert.match(unlock, /ambiguous: true/);
  assert.match(unlock, /signToken\(person\.role, person\.id\)/);
  // The lock screen tries the person first and falls back to the rescue PIN.
  assert.match(app, /staffApi\.unlock\(pin, 8000\)/);
  assert.match(app, /const handleUnlock = async \(pin: string\)/);
  const unlockFn = app.match(/const handleUnlock = async \(pin: string\)[\s\S]*?\n  \};/)?.[0] || '';
  assert.ok(unlockFn.indexOf('staffApi.unlock') < unlockFn.indexOf('authVerify(pin, 8000)'),
    'a staff PIN must be tried before the shop rescue PIN');
  // A PIN shared by two people asks who, and issues no token until they answer.
  assert.match(gate, /Who is this\?/);
  assert.match(gate, /candidates\?\.length/);
  assert.match(app, /handleUnlockPickPerson/);
  // Both doors share one sign-in, so a handover behaves the same either way.
  assert.match(app, /const signInAsSeller = /);
  assert.match(app, /const handleVerifyStaff = [\s\S]{0,400}signInAsSeller\(/);
});

test('the rescue PIN never leaves a manager credential behind', () => {
  const app = read('src/App.tsx');
  // A till unlocked with the shop PIN says TILL on the chip, so the wire must
  // not keep carrying the previous seller's manager token.
  const tillOnly = app.match(/const unlockAsTillOnly = \(\)[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(tillOnly, /setStaffToken\(null\)/);
  assert.match(tillOnly, /setActiveStaffId\(null\)/);
  assert.match(tillOnly, /localStorage\.removeItem\('boss_pos_staff_id'\)/);
  // Both rescue paths (offline fast path and server check) go through it.
  const unlock = app.match(/const handleUnlock = async \(pin: string\)[\s\S]*?\n  \};/)?.[0] || '';
  assert.equal((unlock.match(/unlockAsTillOnly\(\)/g) || []).length, 2);
});

test('no screen promises a PIN that cannot approve anything', () => {
  const app = read('src/App.tsx');
  const sales = read('src/components/Sales.tsx');
  const landing = read('landing/index.html');
  const terms = read('landing/terms.html');
  // The device-only manager PIN is gone, so no screen may still ask for one.
  assert.equal(/title: 'Manager PIN'/.test(app), false);
  assert.doesNotMatch(sales, /big ones ask manager PIN/);
  assert.doesNotMatch(landing, /Manager PIN for refunds/);
  assert.doesNotMatch(terms, /your manager PIN can refund/);
  // And the PIN model is described the same way everywhere: one per person.
  assert.match(landing, /One PIN per person/);
  assert.match(app, /their own staff PIN/);
  assert.match(app, /Rescue PIN \(backup door\)/);
});

test('support details carry the lock history QA promises', () => {
  const app = read('src/App.tsx');
  const summary = app.match(/const summary = supportSummary\(\{[\s\S]*?\}\);/)?.[0] || '';
  assert.match(summary, /lockHistory: lockLog/);
  assert.match(summary, /signedInAs: activeStaff/);
});

test('a refused write leaves a trace, so the next report is answerable', () => {
  const server = read('api/index.js');
  // No body, no amounts: path, method, status, code, actor, trace id.
  assert.match(server, /audit\('write\.refused', `\$\{req\.method\} \$\{req\.path\} \$\{code\}`, actor/);
  assert.equal(/JSON\.stringify\(req\.body\)/.test(server), false);
  // Registered BEFORE the business routes: Express never reaches middleware
  // that sits after a route which already answered, so placing it at the end of
  // the file would trace nothing at all.
  const traceAt = server.indexOf("const REFUSAL_TRACE_SKIP");
  const firstRoute = server.indexOf("app.post('/api/products'");
  assert.ok(traceAt > 0 && traceAt < firstRoute, 'refusal tracing must be registered before the routes');
  // After the auth gate, so the actor can be resolved.
  const gate = server.indexOf('requireAuth(req, res, next).catch(next);');
  assert.ok(traceAt > gate, 'refusal tracing must come after the auth gate to know who acted');
  // Hooked before the send: a 'finish' handler can be frozen out on serverless.
  assert.match(server, /const sendJson = res\.json\.bind\(res\);/);
  assert.equal(/res\.on\('finish'[\s\S]{0,200}write\.refused/.test(server), false);
  // Only writes, and never the PIN endpoints (they fail by design).
  assert.match(server, /const REFUSAL_TRACE_SKIP = new Set\(\['\/api\/auth\/verify', '\/api\/staff\/unlock', '\/api\/staff\/verify', '\/api\/auth\/set'\]\)/);
  // Throttled, so a retry loop cannot bury the line that matters.
  assert.match(server, /const REFUSAL_TRACE_WINDOW_MS = 30 \* 1000/);
  assert.match(server, /if \(Date\.now\(\) - last >= REFUSAL_TRACE_WINDOW_MS\)/);
});

test('a refused credit keeps what the cashier typed', () => {
  const register = read('src/components/CategoryRegister.tsx');
  const app = read('src/App.tsx');
  // Both credit writes report the server's answer, and the form only clears on
  // success. This is money the shop is owed: re-typing it is how debts get lost.
  assert.match(register, /saved = await onAddCreditEat\(\{/);
  assert.match(register, /saved = await onPayCreditEat\(payId, amt\)/);
  const add = register.match(/const handleSubmitCredit = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(add, /if \(saved === false\) return;/);
  assert.ok(add.indexOf('if (saved === false) return;') < add.indexOf("setCreditName('')"),
    'the credit form may only clear once the server confirmed');
  const pay = register.match(/const handlePay = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.ok(pay.indexOf('if (saved === false) return;') < pay.indexOf('setPayId(null)'),
    'a refused payment must keep its amount on screen');
  // And the App side actually reports the refusal instead of swallowing it.
  assert.match(app, /const handleAddCreditEat = async \(newEat: CreditEat\): Promise<boolean>/);
  assert.match(app, /const handlePayCreditEat = async \(id: string, amount: number\): Promise<boolean>/);
});

test('the credit book is named in Settings, not hardcoded in a screen', () => {
  const register = read('src/components/CategoryRegister.tsx');
  const ledger = read('src/components/CreditsLedger.tsx');
  const app = read('src/App.tsx');
  const server = read('api/index.js');
  assert.equal(/Ababanjibwa/.test(register), false);
  assert.equal(/Ababanjibwa/.test(ledger), false);
  // Default is neutral, the shop sets its own.
  assert.match(register, /creditBookName = 'Credit book'/);
  assert.match(register, /title=\{creditBookName\}/);
  assert.match(register, /Added to \$\{creditBookName\}/);
  assert.match(app, /creditBookName=\{settings\.creditBookName \|\| 'Credit book'\}/);
  assert.match(app, /value=\{settings\.creditBookName \|\| ''\}/);
  // A setting the server does not allow is silently dropped, so it must be listed.
  assert.match(app, /'cashierTabs','creditBookName'/);
  assert.match(server, /'cashierTabs', 'creditBookName'/);
});

// The Close-day screen produced every live-money bug report this session, all
// of one shape: a write the till performs that the server refuses. These guards
// keep the remaining instances of that shape from coming back.
test('a seller can correct their own loss and batch entries', () => {
  const server = read('api/index.js');
  // The create side was always open to any seller; a manager-only delete meant
  // a seller could log a mistake but not fix it.
  assert.match(server, /app\.delete\('\/api\/wastage-log\/:id', asHandler/);
  assert.match(server, /app\.delete\('\/api\/production-register\/:id', asHandler/);
  assert.equal(/app\.delete\('\/api\/wastage-log\/:id', requireManager/.test(server), false);
  assert.equal(/app\.delete\('\/api\/production-register\/:id', requireManager/.test(server), false);
  // The create side stays open, or the fix would be one-sided.
  assert.match(server, /app\.post\('\/api\/wastage-log', asHandler/);
});

test('tomorrow\u2019s opening float reaches the server for any seller', () => {
  const server = read('api/index.js');
  const app = read('src/App.tsx');
  // It used to be skipped entirely for a non-manager: the figure showed on
  // screen, fed the money maths, and never left the phone.
  assert.match(server, /const TILL_OWNED_SETTING_KEYS = new Set\(\['eodCapital'\]\)/);
  assert.match(server, /function requireManagerForTillSettings/);
  assert.match(server, /app\.put\('\/api\/settings', requireManagerForTillSettings/);
  // One key, numbers only — nothing else about the shop's settings gets in.
  assert.match(server, /keys\.every\(\(k\) => TILL_OWNED_SETTING_KEYS\.has\(k\)\)/);
  assert.match(server, /Object\.values\(body\.eodCapital\)\.every/);
  // And the client must actually send it: the old blanket early-return dropped
  // the key before a request was ever made, so the server gate was only half
  // the bug. A non-manager now sends that one key and nothing else.
  const push = app.match(/useEffect\(\(\) => \{\s*\n\s*if \(!readyRef\.current\) return;[\s\S]*?\n  \}, \[settings, staffConfigured, activeRole\]\);/)?.[0] || '';
  assert.match(push, /const tillOnly = staffConfigured && activeRole !== 'manager'/);
  assert.match(push, /JSON\.stringify\(\{ eodCapital:/);
  assert.equal(/if \(staffConfigured && activeRole !== 'manager'\) return;/.test(push), false);
});

test('the boot payload no longer hands sellers the manager-only money tables', () => {
  const server = read('api/index.js');
  const app = read('src/App.tsx');
  const api = read('src/api.ts');
  const boot = server.match(/app\.get\('\/api\/boot'[\s\S]*?\n\}\)\);/)?.[0] || '';
  assert.match(boot, /const bootIsManager = await requestIsManager\(req\)/);
  assert.match(boot, /momoTransfers: bootIsManager \? momoTransfers : \[\]/);
  assert.match(boot, /creditPayments: bootIsManager \? creditPayments : \[\]/);
  assert.match(boot, /managerOnlyHidden: bootIsManager \? \[\] : \['momoTransfers', 'creditPayments'\]/);
  // The empty stand-in must NOT be cached, or a seller reads it as a day with
  // no money moved — the exact lie the blocked banner prevents.
  assert.match(app, /if \(hidden\.includes\('momoTransfers'\)\) \{/);
  assert.match(app, /setMoneyOutBlocked\(true\);/);
  assert.match(api, /managerOnlyHidden\?: string\[\]/);
});

test('a refused close-day write never announces success or clears the form', () => {
  const register = read('src/components/CategoryRegister.tsx');
  const app = read('src/App.tsx');
  // Wastage: "Loss logged" used to fire before the server agreed, then the
  // entry rolled back — the reported-it-and-it-vanished report.
  const waste = register.match(/const handleSubmitWastage = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(waste, /saved = await onAddWastage\(\{/);
  assert.ok(waste.indexOf('if (saved === false) return;') < waste.indexOf("setWasteItem('')"),
    'the loss form may only clear once the server confirmed');
  // Recount: the delete has to be awaited or two "remaining" rows stack and the
  // gap maths reads double — the exact failure the code's own comment names.
  const carry = register.match(/const carryRow = async [\s\S]*?\n  \};/)?.[0] || '';
  assert.match(carry, /const removed = await onDeleteWastage\(old\.id\)/);
  assert.match(carry, /if \(removed === false\) \{/);
  assert.ok(carry.indexOf('await onDeleteWastage') < carry.indexOf('await onAddWastage'),
    'the old tray count must be gone before its replacement is written');
  // Reopen day: the local record was cleared BEFORE the server was asked, so a
  // refusal left the till believing a day the server still calls closed was open.
  const reopen = register.match(/const reopenDay = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.ok(reopen.indexOf('await onReopenDay()') < reopen.indexOf('localStorage.removeItem(closedStoreKey)'),
    'the closed record may only be cleared once the server reopened the day');
  assert.match(reopen, /Day not reopened/);
  // And the refusals name themselves.
  assert.match(app, /Loss not saved/);
  assert.match(app, /Not deleted/);
});

test('a close summary that was refused for good says so', () => {
  const register = read('src/components/CategoryRegister.tsx');
  const app = read('src/App.tsx');
  // The counted drawer reaches the server ONLY through this summary, so a silent
  // null left the day's numbers nowhere while promising "next sync".
  assert.match(app, /setCloseSummaryError\(closeSummaryFailure\)/);
  assert.match(app, /closeSummaryError=\{closeSummaryError\}/);
  assert.match(register, /closeSummaryError\?: string/);
  assert.match(register, /Owner summary NOT sent/);
  // Scoped to this function: an unrelated silent catch elsewhere is not the point.
  const finished = app.match(/const handleCloseDayFinished = [\s\S]*?\n  \};/)?.[0] || '';
  assert.equal(/catch \{\s*return null;\s*\}/.test(finished), false);
  assert.match(finished, /catch \(err\) \{/);
});

// The sell screen and the Expenses tab are what a cashier touches all day, so
// they get the same audit the Close screen got.
test('a cashier can undo their own just-rung sale', () => {
  const server = read('api/index.js');
  const app = read('src/App.tsx');
  // The client has always offered this ("<=60s old, no manager PIN") and the
  // gate made it impossible, so the 10-second Undo bar did nothing for sellers.
  assert.match(server, /const SELF_UNDO_WINDOW_MS = 60 \* 1000/);
  assert.match(server, /async function requireManagerOrSelfUndo/);
  assert.match(server, /app\.post\('\/api\/sales\/:id\/refund', requireManagerOrSelfUndo/);
  const gate = server.match(/async function requireManagerOrSelfUndo[\s\S]*?\n\}/)?.[0] || '';
  // Narrow on purpose: same person, inside the window, refund only.
  assert.match(gate, /String\(sale\.staff_id \|\| ''\) === String\(actor\.id\)/);
  assert.match(gate, /Date\.now\(\) - at <= SELF_UNDO_WINDOW_MS/);
  assert.match(gate, /!sale\.refunded && !sale\.voided/);
  // Voiding stays manager-only: only a refund can be self-undone.
  assert.match(server, /app\.post\('\/api\/sales\/:id\/void', requireManager/);
  assert.match(app, /New-cashier safety net: undo your own just-made sale/);
});

test('a seller can read and remove their own spend', () => {
  const server = read('api/index.js');
  // The Expenses tab is deliberately handed to cashiers, and boot already ships
  // this table, while the route refused them and the 403 was reported as a dead
  // connection. Approvals and the report stay manager-only.
  assert.match(server, /app\.get\('\/api\/expenses', asHandler/);
  assert.match(server, /app\.delete\('\/api\/expenses\/:id', asHandler/);
  assert.equal(/app\.delete\('\/api\/expenses\/:id', requireManager/.test(server), false);
  assert.match(server, /app\.get\('\/api\/expenses\/report', requireManager/);
  assert.match(server, /app\.post\('\/api\/expenses\/:id\/approve', requireManager/);
  // A role refusal is reported as a role refusal, not as a connection fault.
  assert.match(read('src/App.tsx'), /Not available on this account: \$\{refused\.join/);
});

test('a category the shop has never used is registered, and a typo is caught', () => {
  const server = read('api/index.js');
  // A cashier cannot save settings, so a category they added could never reach
  // the server: the next expense in it was refused and then deleted on the till.
  assert.match(server, /audit\('expense\.category\.create', wanted/);
  assert.match(server, /ON CONFLICT \(key\) DO UPDATE SET value = EXCLUDED\.value/);
  // The real risk of allowing this is typo sprawl, so a near miss is refused
  // with the name it probably meant.
  assert.match(server, /Did you mean "\$\{nearMiss\}"\?/);
  assert.match(server, /code: 'INVALID_CATEGORY'/);
  assert.match(server, /suggestions: \[nearMiss\]/);
});

test('an ingredient top-up that was refused cannot inflate tomorrow\u2019s float', () => {
  const app = read('src/App.tsx');
  const topUp = app.match(/const handleIngredientTopUp = [\s\S]*?\n  \};/)?.[0] || '';
  // The refusal answer used to be discarded, so the till added money the server
  // never recorded — and that inflated float drove every batch budget.
  assert.match(topUp, /const recorded = await handleAddMomoTransfer\(\{/);
  assert.match(topUp, /if \(recorded === false\) return;/);
  assert.ok(topUp.indexOf('if (recorded === false) return;') < topUp.indexOf('eodCapital:'),
    'the float may only grow once the movement is on the server');
  // One success toast for one action, not two.
  assert.equal(/triggerToast\('Ingredient top-up recorded'/.test(topUp), false);
});

test('renaming a spend category never rewrites history', () => {
  const app = read('src/App.tsx');
  // There is no route to re-categorise an expense, so relabelling existing rows
  // locally made every total drawn from them quietly wrong.
  const rename = app.match(/const handleUpdateExpenseCategory = [\s\S]*?\n  \};/)?.[0] || '';
  assert.equal(/setExpenses/.test(rename), false);
  const remove = app.match(/const handleDeleteExpenseCategory = [\s\S]*?\n  \};/)?.[0] || '';
  assert.equal(/setExpenses/.test(remove), false);
});

test('moving cash between drawers is till work, not a manager decision', () => {
  const server = read('api/index.js');
  const modal = read('src/components/CashTransferModal.tsx');
  // The modal's own default reason is "Change / borrow" and it sits on the Sell
  // toolbar, so all three routes were refusing something a seller does daily.
  assert.match(server, /app\.get\('\/api\/cash-transfers', asHandler/);
  assert.match(server, /app\.post\('\/api\/cash-transfers', asHandler/);
  assert.match(server, /app\.put\('\/api\/cash-transfers\/:id\/settle', asHandler/);
  // A refused move keeps the amount on screen, because the cash is still in hand.
  const submit = modal.match(/const handleRecordTransfer = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(submit, /Move not recorded/);
  assert.ok(submit.indexOf('Move not recorded') < submit.indexOf("setTransferAmt('')"),
    'the amount may only be cleared once the movement is on the server');
});

test('a seller\u2019s paid ingredient prices reach the recipe without opening the pricing door', () => {
  const server = read('api/index.js');
  const put = server.match(/app\.put\('\/api\/products\/:id', requireManager, asHandler[\s\S]*?\napp\.delete\('\/api\/products\/:id'/)?.[0] || '';
  // The batch save writes back what the cook paid, so tomorrow's cost is honest.
  // For a non-manager ONLY those unit costs are read from the payload...
  assert.match(put, /if \(!\(await requestIsManager\(req\)\)\) \{/);
  assert.match(put, /const priced = new Map\(incomingIngredients/);
  assert.match(put, /priced\.has\(key\) \? \{ \.\.\.ing, unitCost: priced\.get\(key\) \} : ing/);
  // ...and every other field is pinned to the stored row, so this can never
  // become a back door to changing a price, a cost, stock or an identity.
  for (const pinned of ['price: Number(current.price || 0)', 'cost: Number(current.cost || 0)',
                        'stockQty: Number(current.stockqty || 0)', 'barcode: current.barcode',
                        'imei: current.imei', 'name: current.name', 'category: current.category']) {
    assert.ok(put.includes(pinned), `missing pinned field: ${pinned}`);
  }
  // No recipe, or nothing priced in it, means there is nothing this may do.
  assert.match(put, /Only a manager can change this item/);
});

test('no success is announced before the write it describes', () => {
  const kitchen = read('src/components/MorningProduction.tsx');
  const quick = read('src/components/QuickExpenseModal.tsx');
  const recipes = read('src/components/EateryPricing.tsx');
  // The batch toast names the batch AND its expense, so it can only fire once
  // both are on the server.
  const submit = kitchen.match(/const submitBatch = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(submit, /const batchSaved = await onAddProduction\(\{/);
  assert.ok(submit.indexOf('if (batchSaved === false) return;') < submit.indexOf("triggerToast(\n        expensed > 0"),
    'the batch toast must wait for the server');
  assert.match(submit, /but the .* ingredient expense was refused/);
  assert.match(kitchen, /disabled=\{savingBatch\}/);
  // Quick expense, and the recipe screens, same rule.
  assert.match(quick, /const written = await onAddExpense\(newExpense\);/);
  assert.match(quick, /if \(written === false\) return;/);
  assert.match(recipes, /const written = await onUpdateProduct\(\{/);
  assert.match(recipes, /if \(written === false\) return;/);
  // And a seller opening the pricing screen is told why, not left filling in a
  // form whose every save is refused.
  assert.match(recipes, /canEdit\?: boolean/);
  assert.match(recipes, /Prices and recipes are a manager/);
});
