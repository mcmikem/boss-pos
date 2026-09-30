import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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
  // Comments are prose, not behaviour: the old chip's label is quoted in a
  // comment explaining why it went, and a guard must not trip on that.
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
  // The browser-API floor is checked as part of the build, because five real
  // bugs came from calling an API the shipped bundles do not polyfill.
  assert.match(packageJson.scripts.build, /npm run browser-apis/);
  // Proof that the fixes are in the ARTIFACT, not just the repository.
  assert.equal(packageJson.scripts['verify:deployed'], 'node scripts/verify-deployed-fixes.mjs');
  assert.ok(existsSync(resolve(root, 'scripts/verify-deployed-fixes.mjs')));
  assert.equal(packageJson.scripts['browser-apis'], 'node scripts/check-browser-apis.mjs');
  assert.ok(existsSync(resolve(root, 'scripts/check-browser-apis.mjs')));
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
  // The manager gate moved INSIDE the product update. It used to sit on the
  // route, which sent a 403 before the handler ran — so the seller recipe logic
  // below it was dead code and a chef could never save what she paid. A test
  // asserting the string was green while the feature was broken.
  assert.match(server, /app\.put\('\/api\/products\/:id', asHandler/);
  assert.match(server, /if \(!\(await hasManagerRole\(req\)\)\) \{/);
  assert.match(server, /confirmed: body\.recipeCostsOnly === true/);
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

test('the rescue PIN never leaves a usable credential behind', () => {
  const app = read('src/App.tsx').replace(/^\s*\/\/.*$/gm, '');
  // A till unlocked with the shop PIN keeps today's NAME (she proved it this
  // morning) but never a token: money out, voids, refunds, prices, reports and
  // settings all refuse a till token server-side.
  const tillOnly = app.match(/const unlockAsTillOnly = \(\)[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(tillOnly, /setStaffToken\(null\)/);
  assert.match(tillOnly, /sellerTodayOf\(\)/);
  assert.equal(/setSellAsTillSession/.test(tillOnly), false);
  // Both rescue paths (offline fast path and server check) go through it.
  const unlock = app.match(/const handleUnlock = async \(pin: string\)[\s\S]*?\n  \};/)?.[0] || '';
  assert.ok((unlock.match(/unlockAsTillOnly\(\)/g) || []).length >= 2);
  assert.match(unlock, /if \(!minted\) \{\s*\n\s*unlockAsTillOnly\(\);\s*\n\s*setAuthState\('locked'\);/);
  assert.match(unlock, /No connection to sign you in/);});

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
  assert.match(server, /function requireManagerForTillSettings/);
  assert.match(server, /isTillOwnedSettingsPayload\(req\.body\)/);
  assert.match(server, /app\.put\('\/api\/settings', requireManagerForTillSettings/);
  // One key, numbers only — nothing else about the shop's settings gets in.
  const rules = read('api/operationsRules.js');
  assert.match(rules, /export const TILL_OWNED_SETTING_KEYS = \['eodCapital'\]/);
  assert.match(rules, /export function isTillOwnedSettingsPayload/);
  assert.match(rules, /Object\.values\(capital\)\.every/);
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
  assert.match(read('api/authz.js'), /export const SELF_UNDO_WINDOW_MS = 60 \* 1000/);
  assert.match(server, /async function requireManagerOrSelfUndo/);
  assert.match(server, /app\.post\('\/api\/sales\/:id\/refund', requireManagerOrSelfUndo/);
  // The decision is a pure, unit-tested function — the gate only gathers facts.
  const gate = server.match(/async function requireManagerOrSelfUndo[\s\S]*?\n\}/)?.[0] || '';
  assert.match(gate, /selfUndoAllowed\(\{/);
  assert.match(gate, /saleStaffId: sale\?\.staff_id/);
  assert.match(gate, /actorId: actor\.id/);
  assert.match(gate, /ageMs: Number\.isFinite\(at\) \? Date\.now\(\) - at : NaN/);
  assert.match(read('api/authz.js'), /export function selfUndoAllowed/);
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

test('an ingredient top-up that was refused cannot inflate tomorrow\'s float', () => {
  const app = read('src/App.tsx');
  const topUp = app.match(/const handleIngredientTopUp[\s\S]*?\n  \};\n/)?.[0] || '';
  // Only OWNER money moves. A drawer and the phone line are already the shop's,
  // so they are a label on the expense and no movement is invented for them.
  assert.match(topUp, /if \(source === 'owner'\) \{/);
  assert.equal((topUp.match(/handleAddMomoTransfer/g) || []).length, 1);
  assert.match(topUp, /direction: 'in'/);
  // And a refused write must not inflate the set-aside either — which is what
  // made every later ingredient budget on the screen too high.
  assert.match(topUp, /if \(recorded === false\) \{/);
  assert.ok(topUp.indexOf('if (recorded === false)') < topUp.indexOf('eodCapital:'),
    'a refused hand-over must return before the float moves');
  // The fabricated shilling is gone: no "|| 1", and a zero shortfall is a no-op.
  assert.equal(/amt \|\| 1/.test(topUp), false);
  assert.match(topUp, /if \(amt <= 0\) return;/);
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
  const put = server.match(/app\.put\('\/api\/products\/:id', asHandler[\s\S]*?\napp\.delete\('\/api\/products\/:id'/)?.[0] || '';
  // The caller must SAY it is only carrying ingredient costs. Without that, a
  // stale cached build sends a whole product, gets 200, and its price change is
  // silently discarded — a refusal turned into a lie.
  assert.match(put, /confirmed: body\.recipeCostsOnly === true/);
  assert.match(put, /delete body\.recipeCostsOnly/);
  for (const caller of [read('src/components/MorningProduction.tsx'), read('src/components/QuickExpenseModal.tsx')]) {
    assert.match(caller, /recipeCostsOnly: true/);
  }
  // The batch save writes back what the cook paid, so tomorrow's cost is honest.
  // For a non-manager ONLY those unit costs are read from the payload...
  assert.match(put, /const pinned = recipeCostOnlyUpdate\(current, body, \{ confirmed:/);
  assert.match(put, /body = \{ \.\.\.body, \.\.\.pinned\.body \}/);
  // No recipe, or nothing priced in it, means there is nothing this may do.
  assert.match(put, /Only a manager can change this item/);
  const rules = read('api/operationsRules.js');
  const fn = rules.match(/export function recipeCostOnlyUpdate[\s\S]*?\n\}/)?.[0] || '';
  // ...and every other field is pinned to the stored row, so this can never
  // become a back door to changing a price, a cost, stock or an identity.
  for (const pinned of ['price: Number(current.price || 0)', 'cost: Number(current.cost || 0)',
                        'name: current.name', 'category: current.category', 'barcode: current.barcode',
                        'imei: current.imei', 'variants: current.variants || null']) {
    assert.ok(fn.includes(pinned), `missing pinned field: ${pinned}`);
  }
  assert.match(fn, /priced\.has\(key\) \? \{ \.\.\.ing, unitCost: priced\.get\(key\) \} : ing/);
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

// A mechanical sweep found these: a handler called without await, with a
// success toast within a few lines. Each is the "announced, then rolled back"
// shape that produced the loss-entry and credit reports.
test('no screen announces a save it has not awaited', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.tsx')) continue;
      const lines = readFileSync(p, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = /^\s*(on[A-Z]\w+|handle[A-Z]\w+)\(/.exec(lines[i]);
        if (!m || lines[i].includes('await')) continue;
        // Tight window on purpose: a save and its confirmation sit together. A
        // wider one sweeps in unrelated toasts further down the same handler and
        // reports copy confirmations as save failures.
        const window = lines.slice(i, i + 4).join('\n');
        if (/triggerToast\(/.test(window) && /'success'/.test(window)) {
          // handleAddToCart is local cart state with deliberate feedback.
          if (m[1] === 'handleAddToCart') continue;
          offenders.push(`${p}:${i + 1} ${m[1]}()`);
        }
      }
    }
  };
  walk(join(root, 'src'));
  assert.deepEqual(offenders, [], `un-awaited write announced as success: ${offenders.join(', ')}`);

  // The window must still be tight ENOUGH to catch the real thing.
  const sample = [
    '  const onThing = () => {',
    '    onSaveThing({ id: 1 });',
    "    triggerToast('Saved', 'success');",
    '  };',
  ];
  const flagged = sample.some((ln, i) => {
    const m = /^\s*(on[A-Z]\w+|handle[A-Z]\w+)\(/.exec(ln);
    if (!m || ln.includes('await')) return false;
    const w = sample.slice(i, i + 4).join('\n');
    return /triggerToast\(/.test(w) && /'success'/.test(w);
  });
  assert.equal(flagged, true, 'the sweep must still catch an un-awaited save announced as success');
});

test('a phone-only change is labelled as one', () => {
  const app = read('src/App.tsx');
  const categories = read('src/components/CategoryManager.tsx');
  const expenses = read('src/components/Expenses.tsx');
  // Categories live in the shop's settings, which a seller cannot push. The
  // change is still useful locally, but the screen must not imply otherwise.
  assert.match(app, /const settingsPersistToServer = !staffConfigured \|\| activeRole === 'manager'/);
  assert.match(app, /const handleAddCategory = \(name: string\): boolean/);
  assert.match(categories, /added on this phone only/);
  assert.match(expenses, /added on this phone/);
  assert.match(expenses, /a manager changes the shop list/);
});

test('a refused credit payment in the ledger does not announce itself as recorded', () => {
  const ledger = read('src/components/CreditsLedger.tsx');
  const pay = ledger.match(/const handleRecordPayment = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(pay, /const written = await onPayCreditEat\(record\.refId, amtNum\)/);
  assert.match(pay, /const written = await onPayCredit\(record\.refId, amtNum\)/);
  // The amount the cashier typed may only be cleared once it is on the server.
  assert.ok(pay.indexOf('if (written === false) return;') < pay.indexOf("setPaymentAmount('')"),
    'a refused payment must keep its amount on screen');
  assert.match(ledger, /onPayCreditEat\?: \(id: string, amount: number\) => void \| boolean/);
});

test('inventory and supplier writes wait for the server', () => {
  const inv = read('src/components/Inventory.tsx');
  const analytics = read('src/components/Analytics.tsx');
  // New item, 20% markdown, duplicate, and both supplier writes.
  assert.match(inv, /const written = await onAddProduct\(newProd\);/);
  assert.match(inv, /const written = await onUpdateProduct\(\{ \.\.\.product, price: next \}\);/);
  assert.match(inv, /const written = await onAddProduct\(copy\);/);
  assert.match(analytics, /if \(await onUpdateSupplier\(updated\) === false\) return;/);
  assert.match(analytics, /if \(await onAddSupplier\(newSup\) === false\) return;/);
  // And the App side says why a product write was refused.
  const app = read('src/App.tsx');
  assert.match(app, /Not saved \\u2014/);
  assert.match(app, /only a manager can change prices and stock/);
});

// Found in production, not in review: 688 unhandled rejections on one phone, all
// "Failed to execute 'put' on 'IDBObjectStore': ... the key parameter was not
// provided". The outbox records store is created with no keyPath, so every
// single IndexedDB write of the outbox threw. Only the localStorage mirror hid
// it — and the read path could then hang forever.
test('the outbox record store is written in a shape the store actually accepts', () => {
  const idb = read('src/utils/outboxIdb.ts');
  // Every store is created out-of-line, with no key generator.
  assert.match(idb, /db\.createObjectStore\(OUTBOX_RECORDS_STORE\)/);
  assert.equal(/createObjectStore\(OUTBOX_RECORDS_STORE,/.test(idb), false);
  // ...so the put must supply a key, or detect a keyPath if a future version
  // creates one (passing a key to a keyed store is itself an error).
  assert.match(idb, /export function putOutboxRecord\(store: IDBObjectStore, entry: unknown, index: number\)/);
  const fn = idb.match(/export function putOutboxRecord[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /if \(store\.keyPath\) \{\s*\n\s*store\.put\(entry\);\s*\n\s*return;/);
  assert.match(fn, /store\.put\(entry, id != null \? String\(id\) : `idx-\$\{index\}`\)/);
  // And a bare keyless put must not survive anywhere in the snapshot writer.
  const snapshot = idb.match(/function writeOutboxSnapshot[\s\S]*?\n\}/)?.[0] || '';
  assert.equal(/records\.put\(entry\)/.test(snapshot), false);
  assert.match(snapshot, /entries\.forEach\(\(entry, index\) => putOutboxRecord\(records, entry, index\)\)/);
});

test('a failed outbox snapshot can never leave a read hanging', () => {
  const idb = read('src/utils/outboxIdb.ts');
  // writeOutboxSnapshot is called from a .then callback inside readCanonicalOutbox,
  // so a throw there rejected a promise nobody awaited and the read never settled.
  const reader = idb.match(/function readCanonicalOutbox[\s\S]*?\n\}/)?.[0] || '';
  assert.match(reader, /const persist = \(snapshotEntries: unknown\[\], snapshotRevision: number\) => \{/);
  assert.match(reader, /try \{ writeOutboxSnapshot\(tx, snapshotEntries, snapshotRevision\); \} catch \{/);
  // Every snapshot write in that function goes through the guarded helper.
  const unguarded = reader.replace(/const persist = [\s\S]*?\n    \};/, '');
  assert.equal(/writeOutboxSnapshot\(tx,/.test(unguarded), false);
});

// Two more signals from the same production data, both on the one older phone:
// "AbortController is not defined" and a denied clipboard write.
test('live sync degrades instead of throwing on a browser without AbortController', () => {
  const app = read('src/App.tsx');
  const sse = app.match(/\/\/ SSE instant sync[\s\S]*?\n  \}, \[authState, applyBootData\]\);/)?.[0] || '';
  // The controller used to be constructed OUTSIDE the try, so the whole stream
  // died in an unhandled rejection on older Android WebViews.
  assert.match(sse, /const hasAbort = typeof AbortController !== 'undefined'/);
  assert.match(sse, /const ctrl = hasAbort \? new AbortController\(\) : null/);
  assert.match(sse, /\.\.\.\(ctrl \? \{ signal: ctrl\.signal \} : \{\}\)/);
  // And nothing escapes the effect unhandled even so.
  assert.match(sse, /connect\(\)\.catch\(\(\) => \{\}\)/);
});

test('copying works where the clipboard API exists but refuses', () => {
  const app = read('src/App.tsx');
  const copy = read('src/utils/copy.ts');
  // navigator.clipboard exists on an older Android WebView and denies every
  // write. That is how "Copy support details" produced empty reports, which is
  // the one thing a support report must never be.
  assert.match(copy, /export async function copyText/);
  assert.match(copy, /catch \{\s*\/\/ Permission denied or no clipboard API/);
  assert.match(copy, /document\.execCommand\('copy'\)/);
  assert.match(copy, /document\.body\.removeChild\(area\)/);
  // Every call site goes through it, and none of them claim success on failure.
  assert.match(app, /const copied = await copyText\(summary\)/);
  assert.match(app, /setSupportFallbackText\(summary\)/);
  assert.match(read('src/components/Customers.tsx'), /await copyText\(text\)/);
  assert.match(read('src/components/CloseSummaryInbox.tsx'), /await copyText\(body\)/);
  assert.equal(/throw new Error\('no clipboard'\)/.test(app), false);
});

// Three of the worst bugs this session were old-Android compatibility failures
// that no amount of review caught. This pins the two the build config promises
// to support: Chrome 49 in the legacy bundle, Chrome 64 in the modern one.
test('money formatting can never throw, whatever the browser\u2019s Intl knows', () => {
  const app = read('src/App.tsx');
  const money = read('src/utils/money.ts');
  // It used to construct Intl.NumberFormat('en-UG') inline, per call, with no
  // fallback — and it formats every price, total and balance on every screen.
  assert.equal(/new Intl\.NumberFormat\('en-UG'/.test(app), false);
  assert.match(app, /const formatCurrency = \(ugxVal: number\) => formatUgx\(ugxVal\);/);
  // Probe the locale with a real value: some builds construct fine and only
  // throw on first use.
  assert.match(money, /const probe = fmt\.format\(1000\)/);
  // Three rungs, ending at a grouping that cannot fail.
  assert.match(money, /new Intl\.NumberFormat\('en-UG'/);
  assert.match(money, /new Intl\.NumberFormat\('en-US'/);
  assert.match(money, /return handRolled;/);
  assert.match(money, /% 3 === 0\) grouped \+= ','/);
  // And a formatter that starts throwing after being cached is replaced, not
  // retried per call.
  assert.match(money, /catch \{\s*\/\/ Last resort, and remember it/);
});

test('no hot path depends on flatMap, which the modern bundle does not polyfill', () => {
  const arrays = read('src/utils/arrays.ts');
  assert.match(arrays, /export function flatMap/);
  // One level only, and it must survive a missing list — which is exactly what
  // these callers pass on a first boot.
  const fn = arrays.match(/export function flatMap[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /if \(!items\) return out;/);
  assert.match(fn, /if \(!projected\) continue;/);

  // Nothing on the money or cart paths may call the built-in.
  for (const file of ['src/utils/cashflow.ts', 'src/components/Sales.tsx',
                      'src/components/CategoryRegister.tsx', 'src/components/departmentRegistry.ts']) {
    const src = read(file);
    assert.equal(/\.flatMap\(/.test(src), false, `${file} still calls Array.prototype.flatMap`);
  }
});

test('a repeating client failure is one row that says how loud it is', () => {
  const sentry = read('src/utils/sentry.ts');
  const server = read('api/index.js');
  // 688 near-identical rows is why the outbox bug needed a GROUP BY to find.
  assert.match(sentry, /const REPEAT_COOLDOWN_MS = 15 \* 60 \* 1000/);
  assert.match(sentry, /if \(withinCooldown && seen\) \{/);
  assert.match(sentry, /count\?: number;/);
  // The count survives to the server, and is bounded there.
  assert.match(sentry, /\.\.\.\(record\.count && record\.count > 1 \? \{ count: record\.count \} : \{\}\)/);
  assert.match(server, /Math\.min\(100000, Math\.max\(1, Math\.round\(Number\(src\.count\)\)\)\)/);
  // And a suppressed repeat does not stop a worsening bug being reported later.
  assert.match(sentry, /state\[key\] = \{ count: 0, lastReportedAt: now \}/);
  assert.match(sentry, /const occurrences = seen \? \(seen\.count \|\| 1\) \+ 1 : 1;/);
});

test('the notes future work reads are not allowed to contradict the code', () => {
  const notes = read('.opencode/summary.md');
  // It claimed SHA-256 with a cyrb53 fallback and that old PINs must be
  // re-set. The code is salted PBKDF2 with a pure-JS fallback for old WebViews,
  // and a stale claim here misleads whoever (or whatever) reads it next.
  assert.doesNotMatch(notes, /cyrb53 fallback/);
  assert.match(notes, /salted PBKDF2/);
  // The current-state section is the one that matters, and it must state the
  // model accurately.
  assert.match(notes, /## Current state/);
  assert.match(notes, /One PIN per person/);
  assert.match(notes, /rescue door/);
  assert.match(notes, /No phone-only "manager PIN" exists/);
  // And the browser floor, which is what let three money-path bugs through.
  assert.match(notes, /Chrome 49/);
  assert.match(notes, /degrade rather than throw/);
});

test('the browser-API floor is enforced, with every exception justified', () => {
  const guard = read('scripts/check-browser-apis.mjs');
  const sentry = read('src/utils/sentry.ts');
  // Object.fromEntries is Chrome 73 with no polyfill in the legacy bundle. It
  // was introduced here TODAY, inside a try/catch that would have silently
  // swallowed the throw and left the error throttle dead on every old phone.
  // The only mention left is the comment saying why it is not used.
  assert.equal(/Object\.fromEntries\s*\(/.test(sentry), false);
  assert.match(sentry, /Object\.fromEntries is Chrome 73/);
  // The floor matches what the build actually ships.
  assert.match(guard, /const MODERN_FLOOR = 64/);
  assert.match(guard, /const LEGACY_FLOOR = 49/);
  // The APIs behind the five production bugs are all named.
  for (const id of ['AbortController', 'navigator.clipboard', 'Array.prototype.flatMap', 'Object.fromEntries']) {
    assert.ok(guard.includes(id), `guard does not cover ${id}`);
  }
  // And every exception must name its handling, so the allowlist is a list of
  // decisions rather than a list of holes.
  const allowed = guard.match(/const ALLOWED = new Map\(\[[\s\S]*?\]\);/)?.[0] || '';
  const entries = allowed.split('\n').filter((l) => l.trim().startsWith('['));
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.ok(/,\s*'[^']{20,}'/.test(entry), `allowlist entry must justify itself: ${entry.trim()}`);
  }
});

test('the deployed-artifact verifier proves itself before it is trusted', () => {
  const verifier = read('scripts/verify-deployed-fixes.mjs');
  // It reads the live precache manifest rather than trusting the repo, and it
  // checks every needle against the local build FIRST. A verifier that cries
  // wolf is worse than none: the first version of this one reported six
  // failures that were all false positives from minification and chunk layout.
  assert.match(verifier, /sw\.js/);
  assert.match(verifier, /localAll\.includes\(m\.needle\)/);
  assert.match(verifier, /The verifier itself is wrong/);
  assert.match(verifier, /\!localAll\.includes\(m\.needle\)/);
  // It reads the server build and refuses to pass against a different one.
  assert.match(verifier, /\/api\/version/);
  assert.match(verifier, /expected && parsed\.short !== expected/);
  // And it checks regressions, not just additions.
  assert.match(verifier, /const FORBIDDEN = \[/);
  assert.match(verifier, /\.flatMap\(/);
  assert.match(verifier, /custom-\$\{Date\.now\(\)\}/);
});

// The design programme, pinned as rules so a later change cannot quietly undo
// the thing that makes a single-business till feel built for one business.
test('a shop that trades in one department is never shown the others', () => {
  const sales = read('src/components/Sales.tsx');
  // Every shop is handed all nine default categories on setup, so the CONFIGURED
  // list cannot decide who this shop is — a tailor was opening onto nine chips.
  assert.match(sales, /const liveDepartments = useMemo\(/);
  assert.match(sales, /categories\.filter\(\(c\) => stocked\.has\(c\)\)/);
  assert.match(sales, /\{liveDepartments\.length > 1 && \(/);
  assert.equal(/\{categories\.length > 1 && \(/.test(sales), false);
  // A logged batch makes a kitchen real before it has any products, so a new
  // chapati shop is recognised from its first morning rather than its first
  // stock import.
  assert.match(sales, /for \(const r of productionRegisters\) if \(r\.category\) stocked\.add\(r\.category\);/);
  // And with no chips to say what this is, the screen says it.
  assert.match(sales, /liveDepartments\.length === 1 && selectedCategory !== 'All'/);
});

test('a Today screen leads with the number that changes a decision', () => {
  const registry = read('src/components/departmentRegistry.ts');
  // A shelf asks where am I; a kitchen asks did I make money. Money on shelves
  // is meaningless when the shelf is a tray of chapati.
  assert.match(registry, /export function kitchenStats\(/);
  assert.match(registry, /label: 'Profit so far'/);
  // The tray words now live in the kitchen's vocabulary rather than being
  // written inline, which is what keeps them out of other trades' screens.
  assert.match(registry, /kitchen: \{ leftover: 'On the tray'/);
  assert.match(registry, /stats\.push\(\{ label: words\.leftover/);
  // Profit is revenue less the ingredients actually paid, on live sales only.
  assert.match(registry, /const costOfSold = sold\.reduce/);
  assert.match(registry, /const profit = Math\.round\(soldValue - costOfSold\)/);
  assert.match(registry, /isLiveSale\(s\)/);
  // Before the first batch, the only useful figure is what yesterday left.
  assert.match(registry, /label: `\$\{words\.leftover\} from yesterday`/);
});

test('a product with one option does not cost a sheet and a second tap', () => {
  const sales = read('src/components/Sales.tsx');
  const card = read('src/components/ProductCard.tsx');
  // One option is not a choice. A single-variant product (one size, one colour,
  // the only cut they make) used to open a sheet that asked for no decision.
  assert.match(sales, /product\.variants && product\.variants\.length === 1\) \{\s*\n\s*handleVariantAdd\(product\.variants\[0\]\);/);
  assert.match(sales, /product\.variants && product\.variants\.length > 1\) \{\s*\n\s*setVariantProduct\(product\);/);
  // And the card says what is behind the tap instead of "500+".
  assert.match(card, /const priceLabel = !hasVariants/);
  assert.match(card, /`\$\{formatCurrency\(minPrice\)\}–\$\{formatCurrency\(maxPrice\)\}`/);
  assert.equal(/\{hasVariants \? '\+' : ''\}/.test(card), false);
});

test('the sign-in screen never names a person the seller did not choose', () => {
  const switcher = read('src/components/StaffSwitcher.tsx');
  const server = read('api/index.js');
  // A pre-highlighted name made a correct PIN fail: the server checked it
  // against the highlighted account. DIANAH was pre-selected because she was
  // the oldest row, so "it brings other names of others but not their names".
  assert.equal(/useState<string>\(staff\[0\]\?\.id/.test(switcher), false);
  assert.match(switcher, /useState<string>\(''\)/);
  assert.match(switcher, /placeholder=\{selectedId \? '4-digit PIN' : 'Tap your name first'\}/);
  // Two people cannot share a name here: the list is the identity.
  assert.match(server, /function sameStaffName/);
  assert.match(server, /code: 'DUPLICATE_STAFF'/);
  // Settings must report the SERVER's PIN state, never a local guess.
  assert.match(server, /hasPin: !!r\.pin_hash/);
  assert.match(read('src/types.ts'), /hasPin\?: boolean;/);
  // And the once-a-day shortcut must not skip the PIN.
  assert.match(read('src/utils/staffMemory.ts'), /sale stamped with a guessed name is a lie in the ledger/);
  assert.equal(/onVerify\(todayPerson\.id, '0000'\)/.test(switcher), false);
});

test('a person can be removed from the till, and a spare name cannot be created', () => {
  const server = read('api/index.js');
  const app = read('src/App.tsx');
  const sales = read('src/components/Sales.tsx').replace(/^\s*\/\/.*$/gm, '');
  // Deleting the spare YAWE: the row said "set up twice" and nothing could be
  // done about it. Turning it off is not the same as gone.
  assert.match(server, /app\.delete\('\/api\/staff\/:id', requireManager/);
  assert.match(server, /code: 'LAST_MANAGER'/);
  assert.match(server, /audit\('staff\.delete'/);
  assert.match(app, /const handleDeleteStaff = async/);
  // Sales carry the name the seller typed, not the account id, so removing
  // somebody must not touch history.
  assert.match(server, /Sales keep the name the seller typed, not the account id/);
  // The sold-out chip is off the till: it sat above the products permanently,
  // and its label contradicted what it did.
  assert.equal(/Show sold-out too/.test(sales), false);
  assert.equal(/In stock only/.test(sales), false);
  assert.match(app, /Sold-out items on the grid/);
  // No name grid may hide people behind a nested scroll again.
  assert.equal(/max-h-\[32vh\] overflow-y-auto/.test(read('src/components/StaffSwitcher.tsx')), false);
});

test('a delete never says it deleted something the server kept', () => {
  const app = read('src/App.tsx').replace(/^\s*\/\/.*$/gm, '');
  const reg = read('src/components/CategoryRegister.tsx').replace(/^\s*\/\/.*$/gm, '');
  const prod = read('src/components/MorningProduction.tsx').replace(/^\s*\/\/.*$/gm, '');
  // Every write path was converted to return the server's answer. The deletes
  // and the bulk paths were the ones left behind, and they are the ones that
  // move money: a money-out row, a loss, a production batch.
  assert.match(app, /const handleDeleteMomoTransfer = async \(id: string\): Promise<boolean>/);
  assert.match(app, /const handlePayCredit = async \(saleId: string, amount: number\): Promise<boolean>/);
  assert.match(app, /const handleSaveCustomer = async \(c: CustomerProfile\): Promise<boolean>/);
  // The screens must ask the server, and must not announce before they do.
  assert.match(reg, /if \(\(await onDeleteMomoTransfer\(t\.id\)\) === false\) return;/);
  assert.match(reg, /if \(\(await onDeleteWastage\(w\.id\)\) === false\) return;/);
  assert.match(prod, /if \(\(await onDeleteProduction\(p\.id\)\) === false\) return;/);
  // A 24px trash icon beside a money figure is one tap from a hole in the day.
  assert.match(reg, /function useArmedDelete/);
  // A stocktake that worked is not an error, and shrinkage is a finding.
  assert.match(read('src/components/StocktakePanel.tsx'), /shrink > 0 \? 'info' : 'success'/);
  assert.match(read('src/components/StocktakePanel.tsx'), /onUpdateProduct: \(p: Product\) => void \| boolean/);
  // "Repeated N batches" was printed before a single one was attempted.
  assert.match(prod, /Repeated \$\{okCount\} of \$\{yesterdayRegs\.length\} batches/);
});

test('nothing that costs money is one tap from gone', () => {
  const sales = read('src/components/Sales.tsx').replace(/^\s*\/\/.*$/gm, '');
  const app = read('src/App.tsx').replace(/^\s*\/\/.*$/gm, '');
  const reg = read('src/components/CategoryRegister.tsx').replace(/^\s*\/\/.*$/gm, '');
  // The mobile sheet has no Clear cart, so a one-tap line removal WAS the
  // destructive path on a phone. Every line now takes two taps, and the minus
  // stepper counts as a removal at the last unit.
  assert.match(sales, /const handleRemoveItem = \(productId: string, variantId: string \| undefined\) => \{\n    const key = `\$\{productId\}::\$\{variantId \|\| ''\}`;\n    const item = cart\.find/);
  assert.equal(/item && item\.qty > 1 && removeConfirmId !== key/.test(sales), false);
  assert.match(sales, /handleRemoveItem\(productId, variantId\);\n        return;/);
  // Park threw the whole cart away with no question, while Clear asked.
  assert.match(sales, /title: 'Park this\? sale\?'|title: 'Park this sale\?'/);
  // Closing the books was one tap and reopening it needs a manager.
  assert.match(reg, /title: 'Close the day\?'/);
  // The role flip and blind close are shop-wide permission changes.
  assert.match(app, /title: `\$\{s\.name\} becomes a \$\{becoming\}`/);
  assert.match(app, /title: 'Hide all totals from cashiers\?'/);
  // The add toast sat across the Cart button 150 times a day; the card carries
  // the count under her finger instead.
  assert.equal(/triggerToast\(`Added: \$\{product\.name\}`, 'success'\);\n  \};/.test(sales), false);
  assert.match(read('src/components/Toast.tsx'), /fixed bottom-36/);
  // The keyboard came up over the grid on every tap of Sell.
  assert.match(sales, /window\.matchMedia\('\(pointer: coarse\)'\)\.matches/);
});

test('the app says where it is, and never shows two different numbers as one', () => {
  const app = read('src/App.tsx').replace(/^\s*\/\/.*$/gm, '');
  const toast = read('src/components/Toast.tsx').replace(/^\s*\/\/.*$/gm, '');
  const modal = read('src/components/ConfirmSaleModal.tsx').replace(/^\s*\/\/.*$/gm, '');
  const inv = read('src/components/Inventory.tsx').replace(/^\s*\/\/.*$/gm, '');
  const reg = read('src/components/CategoryRegister.tsx').replace(/^\s*\/\/.*$/gm, '');
  // Nothing named the screen. One nav item covered two screens each, so four
  // of five screens had no name at all.
  assert.match(app, /const SCREEN_TITLES: Record<string, string>/);
  assert.match(app, /SCREEN_TITLES\[activeTab\]/);
  // Eight settings doors in a 320px strip showed three of them.
  assert.match(app, /grid grid-cols-4 sm:grid-cols-8 gap-1\.5/);
  assert.equal(/overflow-x-auto scrollbar-none">\s*\{SETTINGS_SECTIONS/.test(app), false);
  // A toast inherited the REMAINING time of the one before it, so a confirmation
  // could be gone in under a second, and a background sync report could replace
  // the sentence explaining why her money was refused.
  assert.match(toast, /\}, \[message\]\);/);
  assert.match(app, /<Toast key=\{toastMessage\}/);
  assert.match(app, /toastTypeRef\.current === 'error' && type !== 'error'/);
  // "items" meant lines in one place and units in another, on one dialog.
  assert.match(modal, /more line\{/);
  assert.match(modal, /\(units\)/);
  // Two bare money figures per stock row, one of them sometimes computed.
  assert.match(inv, /product\.recipe \? 'Recipe cost' : 'Cost'/);
  assert.match(inv, />Price<\/p>/);
  // Three close-day columns explained only through tooltips a finger can't reach.
  assert.match(reg, />Expected<\/th>/);
  assert.match(reg, />On hand<\/th>/);
});

test('nothing at the till can look broken, vanish, or hang', () => {
  const gate = read('src/components/PinGate.tsx').replace(/^\s*\/\/.*$/gm, '');
  const sales = read('src/components/Sales.tsx').replace(/^\s*\/\/.*$/gm, '');
  const api = read('src/api.ts').replace(/^\s*\/\/.*$/gm, '');
  const app = read('src/App.tsx').replace(/^\s*\/\/.*$/gm, '');
  // The lock screen awaited a PIN (up to two round-trips) with four filled dots
  // and a live-looking keypad, and accepted a second unlock meanwhile.
  assert.match(gate, /const \[busy, setBusy\] = useState\(false\)/);
  assert.match(gate, /if \(busy \|\| Date\.now\(\) < lockedUntil\) return;/);
  assert.match(gate, /disabled=\{busy \|\| lockedOut\}/);
  // The lockout said "try again in 30s" and swallowed every tap meanwhile.
  assert.match(gate, /const secondsLeft = lockedUntil \? Math\.max\(0, Math\.ceil/);
  assert.match(gate, /Try again in \$\{secondsLeft\}s/);
  // A sale waited the full 30s write timeout for a receipt number before it was
  // even attempted. The server renumbers a Temp # on arrival, so giving up early
  // is safe and the receipt catches up.
  assert.match(api, /const ORDER_NUMBER_WAIT_MS = 2500/);
  assert.equal(/\}, WRITE_TIMEOUT_MS\);\n    if \(res\.ok\) \{\n      const data = await res\.json\(\);\n      \/\/ Keep the local offline fallback counter/.test(api), false);
  // Parked sales were only reachable through a FAB that only exists when the
  // cart is not empty.
  assert.match(sales, /const renderHeldStrip = \(\) =>/);
  assert.match(sales, /tap it under Held to sell it/);
  // Re-locking used to throw away the screen, while the cart draft survived.
  assert.match(app, /localStorage\.getItem\('boss_pos_tab'\)/);
  assert.match(app, /localStorage\.setItem\('boss_pos_tab', activeTab\)/);
  // A spinner, because "Saving sale…" looks the same at 200ms and at a stall.
  assert.match(read('src/components/ConfirmSaleModal.tsx'), /animate-spin/);
});

test('one PIN means one person, and nobody is forced to be somebody else', () => {
  const server = read('api/index.js').replace(/^\s*\/\/.*$/gm, '');
  const gate = read('src/components/PinGate.tsx').replace(/^\s*\/\/.*$/gm, '');
  const sw = read('src/components/StaffSwitcher.tsx').replace(/^\s*\/\/.*$/gm, '');
  const app = read('src/App.tsx').replace(/^\s*\/\/.*$/gm, '');
  // Four accounts ended up sharing one PIN. The sign-in screen cannot tell them
  // apart, so it asks the seller to choose — which is how a person ends up
  // selling under a colleague's name. One PIN, one person, enforced on create
  // and on change, and it says whose it is.
  assert.match(server, /code: 'DUPLICATE_PIN'/);
  assert.equal((server.match(/code: 'DUPLICATE_PIN'/g) || []).length, 2);
  assert.match(server, /cannot use that PIN — \$\{clash\.name\} already has it/);
  assert.match(server, /That PIN already belongs to \$\{taken\.name\}/);
  // The mandatory screen had no exit, so it pushed her into picking somebody.
  assert.match(sw, /onSellAsTill\?: \(\) => void/);
  assert.match(sw, /Sell as the till instead/);
  assert.match(app, /!activeStaff && !sellAsTillSession/);
  assert.match(app, /setSellAsTillSession\(false\);\n    rememberSellerToday/);
  // And the ambiguity screen says what is true instead of leaving her guessing.
  assert.match(gate, /This PIN opens \{candidates\.length\} accounts/);
  assert.match(gate, /do not pick somebody else/);
});

test('the till writes each PIN, and a dead credential never says "Unauthorized"', () => {
  const server = read('api/index.js').replace(/^\s*\/\/.*$/gm, '');
  const api = read('src/api.ts').replace(/^\s*\/\/.*$/gm, '');
  const main = read('src/main.tsx').replace(/^\s*\/\/.*$/gm, '');
  const app = read('src/App.tsx').replace(/^\s*\/\/.*$/gm, '');
  // A shop sets PINs by hand, four people end up on one number, and the sign-in
  // screen then shows four names and not hers. So the till writes the PIN.
  assert.match(server, /async function generateUniquePin/);
  assert.match(server, /app\.post\('\/api\/staff\/:id\/new-pin', requireManager/);
  // No PIN in the audit, ever: it can say one was written, never what it is.
  assert.match(server, /PIN written by the till/);
  assert.equal(/audit\([^)]*\$\{pin\}/.test(server), false);
  // The digits come back exactly once.
  assert.match(server, /res\.json\(\{ id, name, role, active: true, hasPin: true, pin \}\)/);
  assert.equal(/localStorage\.setItem\('[^']*pin[^']*', created\.pin/.test(app), false);
  // An account that is gone is not a valid identity, and the client is told why.
  assert.match(server, /code: 'STAFF_GONE'/);
  assert.match(api, /if \(code === 'STAFF_GONE'\)/);
  assert.match(app, /setAuthState\('locked'\);\n      triggerToast\(\n        reason \|\|/);
  // And a till that cannot start is never a black rectangle.
  assert.match(main, /function paintRecovery/);
  assert.match(main, /Reload the till/);
  assert.match(main, /Nothing you sold today has been lost/);
});

test('the PIN is asked once a day; the till PIN never carries authority', () => {
  const app = read('src/App.tsx').replace(/^\s*\/\/.*$/gm, '');
  const gate = read('src/components/PinGate.tsx').replace(/^\s*\/\/.*$/gm, '');
  // The rescue door keeps today's NAME (she proved it this morning, and the
  // sales after that are hers) but drops the CREDENTIAL — for everyone, not
  // just managers. Money out, voids, refunds, prices, reports and settings all
  // refuse a till token server-side; the manager-PIN challenge hands them back.
  const tillOnly = app.match(/const unlockAsTillOnly = \(\)[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(tillOnly, /setStaffToken\(null\)/);
  assert.match(tillOnly, /sellerTodayOf\(\)/);
  assert.match(tillOnly, /setActiveStaffId\(todaysSeller\.id\)/);
  assert.match(tillOnly, /localStorage\.setItem\('boss_pos_staff_id', todaysSeller\.id\)/);
  assert.equal(/setSellAsTillSession/.test(tillOnly), false);
  // ...unless nobody signed in today, in which case there is no name to keep.
  assert.match(tillOnly, /setActiveStaffId\(null\)/);
  // Booting into yesterday's person is the same thing, so the day stamp rules.
  assert.match(app, /today\?\.id === id \? id : null/);
  // The explicit "sell as the till" choice is the only thing that clears all.
  assert.match(app, /forgetSellerToday\(\);\s*\n\s*setSellerToday\(null\)/);
  // And the lock screen says the model out loud.
  assert.match(gate, /stickyName\?: string \| null/);
  assert.match(gate, /Still \$\{stickyName\} — till PIN opens/);
  assert.match(gate, /Manager powers need their own PIN, typed fresh/);
});


test('no write statement hides a multi-column CTE inside a scalar subquery', () => {
  const api = read('api/index.js');
  // Postgres reads (SELECT * FROM x) as a SCALAR subquery, so a CTE that
  // returns more than one column rejects the whole statement with
  // "subquery must return only one column". That silently killed five writes —
  // production batches, credit payments, credit book lines, expense approvals,
  // and closing the day — while their side effects (the ingredient expense, the
  // audit row) still landed, so the shop saw the money and lost the work.
  const offenders = api.match(/\(SELECT \* FROM [a-z_]+\) AS [a-z_]+/g) || [];
  assert.deepEqual(offenders, [], `scalar subquery over a multi-column CTE: ${offenders.join(', ')}`);
  // The five statements must still read their row back explicitly.
  assert.match(api, /SELECT \(SELECT count\(\*\)::int FROM ins\) AS inserted, \(SELECT id FROM prod\) AS product_id/);
  assert.match(api, /const savedPayment = await sql`SELECT \* FROM credit_payments WHERE id=\$\{id\}`;/);
  assert.match(api, /const savedEat = await sql`SELECT \* FROM credit_eats WHERE id=\$\{id\}`;/);
  assert.match(api, /const afterApproval = await sql`SELECT \* FROM expenses WHERE id=\$\{req\.params\.id\}`;/);
  // And no statement may select a whole CTE where one column was meant.
  assert.equal(/\(SELECT \* FROM (ins|updated|payment|session|expense|paid|prod|event|target|state)\) AS/.test(api), false);
});

test('no sql template interpolates a name the file does not declare', () => {
  // In sql`... ${x} ...` the interpolation is JAVASCRIPT. Writing SQL inside one
  // — `${status === 'submitted' ? at : e.submitted_at}` — makes the engine
  // evaluate `e.submitted_at` as an identifier, and every request through that
  // handler dies with a ReferenceError that the global handler reports as a 500.
  // Three endpoints were broken this way and no type check or unit test saw it.
  const out = execFileSync(process.execPath, ['scripts/check-sql-interpolations.mjs', 'api/index.js'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(out, /PASS/);
});

test('no screen claims a save the server refused', () => {
  // The recurring shape: a write prop called without await, then a success
  // toast. It was true of 14 sites at once because the prop types were `void`,
  // so TypeScript could not see the discarded promise at all.
  const offenders = [];
  const files = [
    'src/components/Inventory.tsx', 'src/components/Analytics.tsx',
    'src/components/Dashboard.tsx', 'src/components/Expenses.tsx',
    'src/components/Customers.tsx', 'src/components/CategoryRegister.tsx',
  ];
  for (const f of files) {
    const lines = read(f).split('\n');
    lines.forEach((line, i) => {
      if (!/triggerToast\(.*'success'\)/.test(line)) return;
      // look back four lines for a write that was never awaited
      const before = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
      const writes = before.match(/\b(on(Add|Update|Delete|Upsert|Save)\w*|onAddWastage|onDeleteWastage|onDeleteExpense|onDeleteCustomer|onDeleteProduct|onUpsertQuote)\s*\(/g) || [];
      if (!writes.length) return;
      if (before.includes('await ') || /=== false\)/.test(before)) return;
      offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `success toast near an un-awaited write: ${offenders.join(', ')}`);

  // And the write props that hide the promise must stay widened. A `void`
  // return type is right for a navigation callback and wrong for a save: it
  // makes TypeScript blind to the discarded promise, which is how fourteen
  // un-awaited writes compiled in the first place.
  const WRITE_PROPS = [
    'onAddProduct', 'onUpdateProduct', 'onDeleteProduct', 'onAddExpense', 'onDeleteExpense',
    'onUpsertQuote', 'onDeleteQuote', 'onDeleteSupplier', 'onDeleteCustomer', 'onSaveCustomer',
    'onAddWastage', 'onDeleteWastage', 'onAddProduction', 'onDeleteProduction',
    'onPayCreditEat', 'onAddSale',
    // onDeleteCategory is deliberately absent: App's handleDeleteCategory makes
    // no server call at all (it re-files products locally), so `void` is the
    // honest type there. That local-only behaviour is a known limitation, not a
    // swallowed refusal.
  ];
  const all = readdirSync(resolve(root, 'src/components'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => `src/components/${f}`)
    .concat(['src/App.tsx']);
  for (const f of all) {
    const src = read(f);
    for (const m of src.matchAll(/\bon(?:Add|Update|Delete|Upsert|Save|Pay)[A-Za-z]*\??\s*:\s*\([^)]*\)\s*=>\s*void;/g)) {
      const name = m[0].match(/on[A-Za-z]+/)[0];
      if (!WRITE_PROPS.includes(name)) continue;
      assert.fail(`${f} declares ${name} as returning void — widen it or the next save is invisible`);
    }
  }
});

test('a service deposit is never announced when the sale was refused', () => {
  const service = read('src/utils/serviceSale.ts');
  const bookings = read('src/components/Bookings.tsx');
  const tailor = read('src/components/TailoringOrders.tsx');
  // A deposit handed over, refused by the server, and then reported as "rung"
  // with the order marked delivered. ringServiceSale now throws, and every
  // handover path catches it and leaves the job open.
  assert.match(service, /written && typeof written === 'object' && written\.status === 'failed'/);
  assert.match(service, /throw new Error\(written\.error/);
  assert.match(bookings, /The balance was not recorded, so the job is still open/);
  assert.match(tailor, /The balance was not recorded, so the order stays open/);
  assert.match(tailor, /const rung = await ringTailoringSale/);
  // Refund-then-re-ring: a refused re-ring leaves the customer with the goods
  // AND their money back.
  assert.match(read('src/App.tsx'), /Returned \$\{label\}, but the balance sale was refused/);
});

test('no department borrows another department\'s words or its name', () => {
  const sales = read('src/components/Sales.tsx').replace(/^\s*\/\/.*$/gm, '');
  const today = read('src/components/DepartmentToday.tsx').replace(/^\s*\/\/.*$/gm, '');
  const registry = read('src/components/departmentRegistry.ts');
  // "On the tray" reached a TAILOR because the stats ternary sent every
  // non-'sell' department to kitchenStats — and Tailoring is kind 'orders'.
  assert.match(sales, /shopProfile\.statsFor\(dept, \{/);
  // The selector is GONE, not corrected: the screen no longer chooses, so there
  // is no branch left to be wrong.
  assert.equal(/dept\.kind ===/.test(sales), false);
  // Every kitchen-kind department really is a kitchen, and no orders department is.
  const kinds = [...registry.matchAll(/key: '([A-Za-z]+)',[\s\S]{0,400}?kind: '(\w+)'/g)].map(m => [m[1], m[2]]);
  for (const [name, kind] of kinds) {
    if (['Tailoring', 'Graphics', 'Bookings', 'Repairs'].includes(name)) {
      assert.notEqual(kind, 'kitchen', `${name} must not speak kitchen words`);
    }
  }
  // And a department is not named twice on one screen.
  assert.match(today, /showTitle = true/);
  assert.match(today, /showTitle && <div className="flex items-center gap-2\.5">/);
  assert.match(sales, /showTitle=\{!\(liveDepartments\.length === 1 && selectedCategory !== 'All'\)\}/);
});

test('what a shop trades in is asked once, never guessed, and never blanks the till', () => {
  const sales = read('src/components/Sales.tsx').replace(/^\s*\/\/.*$/gm, '');
  const app = read('src/App.tsx').replace(/^\s*\/\/.*$/gm, '');
  const card = read('src/components/ShopTrades.tsx').replace(/^\s*\/\/.*$/gm, '');
  // It used to be INFERRED on every screen from stock and production, which is
  // why a tailor got kitchen numbers. Now it is asked and looked up.
  assert.match(sales, /departmentsForShop\(available, settings\?\.trades\)/);
  assert.equal(/real\.length \? real : categories;\s*\};/.test(sales), false);
  // A shop that has not answered keeps today's behaviour, so this is safe to
  // ship to a live till — the question is inert until she answers it.
  assert.match(app, /showTradeQuestion=\{!tradesAsked\}/);
  assert.match(app, /localStorage\.getItem\('boss_pos_trades_asked'\)/);
  // No modal: she opens this app to sell.
  assert.equal(/confirmDialog\({[^}]*title: 'What does this shop trade in/.test(card), false);
  assert.equal(/promptDialog/.test(card), false);
  // Save and skip both stop it asking on this phone.
  assert.match(app, /boss_pos_trades_asked', '1'/);
  // And it is revisable, with a way back to everything.
  assert.match(app, /<ShopTrades[\s\S]*?compact/);
  assert.match(card, /Show every department again/);
  // Saving is a settings write, never a sale write: no money path is touched.
  assert.equal(/onAddSale|handleAddSale/.test(card), false);
});

test('a screen asks the shop profile instead of deciding for itself', () => {
  const sales = read('src/components/Sales.tsx').replace(/^\s*\/\/.*$/gm, '');
  const registry = read('src/components/departmentRegistry.ts');
  // The decision that handed a tailor the kitchen's numbers lived in a ternary
  // in the screen. There is now no kind decision left in Sales.tsx at all.
  assert.equal(/dept\.kind ===|dept\.kind !==/.test(sales), false, 'Sales.tsx must not branch on a department kind');
  assert.match(sales, /const shopProfile = useMemo\(\(\) => resolveShopProfile\(settings\?\.trades\)/);
  assert.match(sales, /shopProfile\.statsFor\(dept, \{/);
  // productionFirst already implies "kitchen", so it decides on its own.
  assert.match(sales, /if \(dept\.productionFirst\) \{/);
  // And the words live with the shape.
  assert.match(registry, /export const TRADE_VOCABULARY: Record<DepartmentKind, TradeVocabulary>/);
  assert.match(registry, /kitchen: \{ leftover: 'On the tray'/);
  assert.match(registry, /orders: \{ leftover: 'Ready for collection'/);
  // "On the tray" survives only in the kitchen vocabulary and in prose about it.
  const trayWords = (registry.match(/On the tray/g) || []).length;
  assert.ok(trayWords <= 3, `the tray phrase appears ${trayWords} times in the registry`);
});

test('a card means "today, one tap from done" — and belongs to one trade only', () => {
  const actions = read('src/components/DepartmentActions.tsx').replace(/^\s*\/\/.*$/gm, '');
  // The last seam: a screen passed a KIND, so it could hand a tailor the
  // kitchen's cards by passing the wrong value. It passes the department now.
  assert.match(actions, /dept: DepartmentConfig;/);
  assert.equal(/kind: 'sell' \| 'kitchen' \| 'orders';/.test(actions), false);
  assert.match(actions, /const kind = dept\.kind;/);
  // And the tray words exist in exactly one place: the kitchen vocabulary.
  assert.match(actions, /const words = TRADE_VOCABULARY\[kind\];/);
  assert.equal(/still on the tray/.test(actions), false, 'the tray phrase must not be retyped here');
  assert.match(actions, /still \$\{words\.leftover\.toLowerCase\(\)\} from yesterday/);
  assert.equal(read('src/components/Sales.tsx').includes('kind: dept.kind,'), false);
});

test('a seller may CLAIM a hand-over to a manager, and nothing else', () => {
  const server = read('api/index.js');
  const reg = read('src/components/CategoryRegister.tsx').replace(/^\s*\/\/.*$/gm, '');
  const app = read('src/App.tsx');
  // Not all shops have a manager in the building, so a closer must be able to
  // say where the money went to a person. It is a claim that the named manager
  // confirms — not a permission to move money.
  assert.match(server, /async function sellerMayClaimHandover/);
  assert.match(server, /readSettingValue\('cashierHandover'\)/);
  assert.match(server, /code: 'HANDOVER_CLAIM_ONLY'/);
  // The door is one destination wide. Float, owner and bank stay manager-only,
  // and the manager gate is otherwise untouched.
  assert.match(server, /if \(to !== 'manager'\) \{/);
  assert.equal(/app\.post\('\/api\/momo-transfers', asHandler/.test(server), false);
  // A seller sees ONE destination, not five buttons where one is permitted.
  assert.match(reg, /MONEY_DEST_ALL\.filter\(d => d\.key === 'manager'\)/);
  assert.match(reg, /MONEY_DEST\.length === 1 \? 'grid-cols-1' : 'grid-cols-5'/);
  // The receipt is still the manager's to give: confirm stays manager-only.
  assert.match(server, /app\.post\('\/api\/money-handover\/:id\/confirm', requireManager/);
  // And it is a setting she can see and turn off.
  assert.match(app, /Cashier can record a hand-over to a manager/);
  assert.match(app, /not yet confirmed/);
});

test('money given to a manager is not money on the phone line', () => {
  const cash = read('src/utils/cashflow.ts');
  // 'manager' fell through to the float bucket, so cash handed to a person was
  // recorded as money put on the mobile-money line — and it was not in
  // movedOut either, so a shop that did the right thing could never balance.
  assert.match(cash, /else if \(t\.to === 'manager'\) d\.manager \+= t\.amount \|\| 0;/);
  assert.match(cash, /const movedOut = floatOut \+ cashOut \+ ownerOut \+ managerOut \+ bankOut;/);
  assert.match(cash, /managerOut\?: number;/);
  // float is still the phone line, so the two cannot be confused again.
  assert.match(cash, /else d\.float \+= t\.amount \|\| 0;/);
});

test('an over-budget batch cannot save without saying where the money came from', () => {
  const mp = read('src/components/MorningProduction.tsx').replace(/^\s*\/\/.*$/gm, '');
  const sales = read('src/components/Sales.tsx').replace(/^\s*\/\/.*$/gm, '');
  // It used to ask as a free-text note, so the answer could be a sentence and
  // still never reach the books — and it assumed phone float either way.
  assert.match(mp, /Choose where the ingredient money is coming from before saving/);
  assert.match(mp, /if \(spend > 0 && !topUpSource\) \{[\s\S]*?return;/);
  assert.match(mp, /onRequestTopUp\?\.\(spend - availableBudget, topUpSource \|\| 'drawer'\)/);
  // The expense is written with the answer, so float maths is right first time
  // instead of being corrected after the fact.
  assert.match(mp, /source: topUpSource === 'momo' \? 'momo' : 'drawer'/);
  // And the old prose question is gone, so there is only one question.
  assert.equal(/Where is the extra money coming from\?'/.test(sales), false);
  assert.equal(/promptDialog\(\{[\s\S]{0,400}Need more ingredient money/.test(sales), false);
  assert.match(sales, /onRecordIngredientTopUp\?\.\(missing, source\)/);
  // The three answers are the shop's words.
  assert.match(mp, /label: 'From the drawer'/);
  assert.match(mp, /label: 'From the phone line'/);
  assert.match(mp, /label: 'Owner gave it to me'/);
});

test('a chef can record what she bought, and the recipe never takes her quantities', () => {
  const mp = read('src/components/MorningProduction.tsx').replace(/^\s*\/\/.*$/gm, '');
  const rules = read('api/operationsRules.js');
  // A snack with no recipe used to hide the ingredient editor entirely, so the
  // only way in was typing a cost price each — and that guess was labelled
  // "ingredients" on the screen.
  assert.match(mp, /\+ Add ingredient/);
  assert.match(mp, /This snack has no recipe yet\. Add what you bought/);
  assert.equal(/No recipe for this item/.test(mp), false);
  // And a chef can START a recipe: the pure rule allows creating one, with every
  // other field still pinned to the stored row.
  assert.match(rules, /No recipe yet\. A chef who has just bought the ingredients/);
  assert.match(rules, /recipe: \{ yield: Number\(incomingRecipe\.yield\) \|\| 1, ingredients: created \}/);
  // The recipe keeps PRICES. Today's bought quantities are never written back,
  // because a lighter batch or two spoiled is an ordinary day, not a new recipe.
  assert.match(mp, /The quantities you bought today are for today only/);
  assert.match(mp, /boughtTouched: true/);
  // Writing the recipe is a CONFIRMATION, and declining still saves the batch.
  assert.match(mp, /confirmLabel: 'Save the recipe'/);
  assert.match(mp, /cancelLabel: 'Just this batch'/);
  // The cost price is worked out from the ingredients, not typed.
  assert.match(mp, /const derivedCostEach = batchQtyNum > 0 \? Math\.round\(formSpend \/ batchQtyNum\) : 0;/);
  // One source for the cost, so the screen cannot contradict itself: profit,
  // margin and ingredients all read formSpend.
  assert.match(mp, /const batchProfit = batchRevenue - formSpend;/);
  assert.match(mp, /const batchMargin = batchRevenue > 0 \? Math\.round\(\(batchProfit \/ batchRevenue\) \* 100\) : 0;/);
  assert.equal(/const batchProfit = batchRevenue - batchSpend;/.test(mp), false);
});

test('the ingredient money says where it came from, on every batch', () => {
  const mp = read('src/components/MorningProduction.tsx').replace(/^\s*\/\/.*$/gm, '');
  // Every batch, not only an overspend: the expense has to land against the
  // right money or the close maths is wrong.
  assert.match(mp, /Where is this money coming from\?/);
  assert.match(mp, /Choose where the ingredient money is coming from before saving/);
  assert.equal(/This batch is over the money set aside\n/.test(mp), false);
  // A drawer and a phone line are a label; owner money is the only one that moves.
  assert.match(mp, /source: topUpSource === 'momo' \? 'momo' : 'drawer'/);
  assert.match(mp, /label: 'Owner gave it to me'/);
  assert.match(mp, /They will be asked to confirm|confirm they handed this over/);
});

test('the ingredient name can be TYPED, in words a cook would say', () => {
  const mp = read('src/components/MorningProduction.tsx').replace(/^\s*\/\/.*$/gm, '');
  // The name control was chosen by `ing.name ? text : input`, so the FIRST
  // character made the input unmount itself mid-word: one letter stuck and the
  // rest went nowhere. It is chosen by where the row came from instead.
  assert.match(mp, /const isNewLine = !ing\.id;/);
  assert.equal(/\{ing\.name \? \(\s*<p/.test(mp), false, 'a row must not swap its name input for text once it has a name');
  assert.match(mp, /\{isNewLine \? \(/);
  // The questions she asked for, as the labels, and the unit she needs: "2" of
  // what? Ingredients are weighed and measured.
  assert.match(mp, /How much was bought\?/);
  assert.match(mp, /What did it cost\?/);
  assert.match(mp, /What ingredient did you buy\?/);
  assert.match(mp, /list="ingredient-units"/);
  for (const u of ['kg', 'L', 'pcs', 'bunches', 'bags']) {
    assert.match(mp, new RegExp(`'${u}'`));
  }
  // Big enough for a thumb on a cheap phone: the fields were h-8/h-10 at 9px.
  assert.match(mp, /h-11 bg-zinc-900 border border-zinc-800 text-white rounded-lg px-3 text-sm/);
  assert.equal(/text-\[9px\] font-black text-zinc-500 uppercase/.test(mp), false);
  // And the add button sits under the rows, where the next line goes.
  assert.match(mp, /\+ Add ingredient\n            <\/button>\n            <datalist/);
});
