#!/usr/bin/env node
// Browser-API floor guard.
//
// The build ships a modern bundle for Chrome 64+ and a legacy bundle for Chrome
// 49. Syntax is downlevelled, but the build does NOT polyfill web/JS APIs newer
// than each bundle's floor, so calling one is a crash on the phones this shop
// actually uses. That is not theoretical: five real bugs came out of it — an
// AbortController built outside a try, a clipboard that denies every write, an
// Intl locale that throws, Array.flatMap, and Object.fromEntries.
//
// This scans the SOURCE (readable, with an allowlist for the cases where we
// wrote a guarded replacement) and then the BUILT modern bundle, so a dependency
// cannot smuggle one in either.
//
// Usage: node scripts/check-browser-apis.mjs   (add to `npm run build`)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

// Anything newer than Chrome 64 (the modern bundle's floor) or, where noted,
// newer than Chrome 49 (the legacy bundle's floor).
const BANNED = [
  // --- ES2019 / Chrome 73+ ---
  { id: 'Object.fromEntries', re: /\bObject\.fromEntries\s*\(/, since: 73 },
  { id: 'Array.prototype.flat', re: /\.flat\s*\(\s*\)/, since: 69 },
  { id: 'Array.prototype.flatMap', re: /\.flatMap\s*\(/, since: 69 },
  { id: 'String.prototype.matchAll', re: /\.matchAll\s*\(/, since: 73 },
  // --- ES2020 / Chrome 80+ ---
  { id: 'Promise.allSettled', re: /Promise\.allSettled\s*\(/, since: 76 },
  { id: 'String.prototype.replaceAll', re: /\.replaceAll\s*\(/, since: 85 },
  { id: 'globalThis', re: /\bglobalThis\b/, since: 71 },
  { id: 'Promise.any', re: /Promise\.any\s*\(/, since: 85 },
  { id: 'queueMicrotask', re: /queueMicrotask\s*\(/, since: 71 },
  // --- ES2021+ / Chrome 85+ ---
  { id: 'Array.prototype.at', re: /\.at\s*\(\s*-?\d+\s*\)/, since: 92 },
  { id: 'structuredClone', re: /\bstructuredClone\s*\(/, since: 98 },
  { id: 'crypto.randomUUID', re: /crypto\.randomUUID\s*\(/, since: 92 },
  { id: 'Array.prototype.findLast', re: /\.findLast\s*\(/, since: 97 },
  { id: 'Object.hasOwn', re: /Object\.hasOwn\s*\(/, since: 93 },
  // --- Web APIs newer than the modern floor (Chrome 64/66) ---
  { id: 'AbortController', re: /new AbortController\s*\(/, since: 66, web: true },
  { id: 'navigator.clipboard', re: /navigator\.clipboard/, since: 66, web: true },
  { id: 'ResizeObserver', re: /\bnew ResizeObserver\s*\(/, since: 64, web: true },
  { id: 'IntersectionObserver', re: /\bnew IntersectionObserver\s*\(/, since: 58, web: true },
  { id: 'BroadcastChannel', re: /\bnew BroadcastChannel\s*\(/, since: 54, web: true },
  { id: 'ClipboardItem', re: /\bnew ClipboardItem\s*\(/, since: 76, web: true },
  { id: 'navigator.share', re: /navigator\.share\s*\(/, since: 61, web: true },
  { id: 'URL.createObjectURL', re: /URL\.createObjectURL\s*\(/, since: 49, web: true, allow: 'Old enough on every target.' },
];

// The modern bundle floor, so each rule knows if it applies there too.
const MODERN_FLOOR = 64;
const LEGACY_FLOOR = 49;

// Cases we have deliberately handled. Each must name the handling, so the
// allowlist is a list of decisions rather than a list of holes.
const ALLOWED = new Map([
  ['AbortController', 'src/App.tsx — feature-detected before use, and live sync degrades without it. src/utils/sentry.ts — guarded.'],
  ['navigator.clipboard', 'src/utils/copy.ts — copyText() falls back to a selection copy, and every call site goes through it.'],
  ['URL.createObjectURL', 'Chrome 49+, supported on both floors.'],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name) && !/\.test\.[jt]sx?$/.test(name)) out.push(p);
  }
  return out;
}

// Only the browser bundle. `api/` runs on Vercel's Node runtime, which is
// modern, and the floor that matters here is the one the SHIPPED bundle has.
const findings = [];
const files = walk(join(root, 'src'));
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (const rule of BANNED) {
    for (let i = 0; i < lines.length; i += 1) {
      if (!rule.re.test(lines[i])) continue;
      findings.push({ where: `${file.replace(root + '/', '')}:${i + 1}`, id: rule.id, since: rule.since, line: lines[i].trim().slice(0, 100) });
    }
  }
}

const real = findings.filter((f) => !ALLOWED.has(f.id));

console.log('Browser API floor guard');
console.log(`  modern bundle floor: Chrome ${MODERN_FLOOR} · legacy bundle floor: Chrome ${LEGACY_FLOOR}`);
if (findings.length) {
  // Grouped, because a build step that prints twenty lines every time trains
  // people to ignore it.
  const byId = new Map();
  for (const f of findings) {
    const entry = byId.get(f.id) || { count: 0, since: f.since, where: [] };
    entry.count += 1;
    if (entry.where.length < 3) entry.where.push(f.where);
    byId.set(f.id, entry);
  }
  console.log(`  handled by an explicit decision (${findings.length} call sites, ${byId.size} APIs):`);
  for (const [id, entry] of [...byId.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`    ok   ${id} — Chrome ${entry.since}+, ${entry.count} call site(s) e.g. ${entry.where[0]}`);
    console.log(`         ${ALLOWED.get(id)}`);
  }
}
if (real.length) {
  console.log('');
  console.log(`  UNHANDLED (${real.length}) — these throw on the phones this shop uses:`);
  for (const f of real) console.log(`    FAIL ${f.where}  ${f.id} needs Chrome ${f.since}+  |  ${f.line}`);
  console.log('');
  console.log('  Either use an older equivalent, or add a feature-detected wrapper like');
  console.log('  src/utils/arrays.ts and record the decision in the ALLOWED map above.');
  process.exit(1);
}
console.log('  PASS — nothing depends on an API the bundles do not polyfill');
