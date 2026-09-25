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
