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
