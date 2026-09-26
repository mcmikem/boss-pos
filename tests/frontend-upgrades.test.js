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
  assert.match(app, /Only a manager can move money out — sign in with your manager PIN/);
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
  // Manager authority is the signed-in staff account, checked by the server.
  // A local 4-digit PIN cannot authorise anything, so it is never collected.
  const requirePin = app.match(/const requirePin = [\s\S]*?\n  \};/)[0];
  assert.equal(/boss_pos_manager_pin/.test(requirePin), false);
  assert.equal(/promptDialog\(\{ title: 'Manager PIN'/.test(app), false);
  assert.match(requirePin, /Only a manager can do this — sign in with a manager staff PIN/);
  // The one place the old key is still mentioned can only remove it.
  assert.match(app, /Remove old phone-only PIN/);
  // The top bar says who this phone is signed in as, on phones too.
  assert.match(app, /\{isManager \? 'MGR' : activeStaff \? 'CSH' : 'TILL'\}/);
  assert.match(app, /canManageMoneyOut=\{isManager\}/);
});
