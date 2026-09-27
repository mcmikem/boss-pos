#!/usr/bin/env node
// Verify that what we fixed is what the PHONES actually download.
//
// Source and a passing build say nothing about the artifact: the service worker
// serves hashed chunks, and a stale or partially-updated deploy would leave
// every phone on the old code while the repository looks correct. This reads the
// live sw.js precache manifest, fetches the real chunks, and looks for a
// distinctive marker of each fix.
//
// Needles are deliberately SHORT and format-insensitive. A previous version of
// this script "failed" six fixes that were all present, because minification
// renames locals, flips quotes, and puts lazy-screen text in its own chunk. A
// verifier that cries wolf is worse than none, so each needle is checked
// against the local build first: if it is not in dist/, the needle is wrong.
//
// Usage: node scripts/verify-deployed-fixes.mjs [expectedBuild]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.VERIFY_BASE || 'https://imac-pos.vercel.app';
const root = resolve(new URL('..', import.meta.url).pathname);

// Only the modern bundle is searched: it is the one with no transpilation, so a
// literal that survives there is a literal the browser will see.
const MARKERS = [
  { id: 'outbox record store supplies a key', needle: 'idx-', why: 'the outbox store could never be written to' },
  { id: 'money formatting cannot throw', needle: 'UGX ', why: 'formatCurrency threw without en-UG locale data' },
  { id: 'live sync survives a missing AbortController', needle: 'AbortController', why: 'the SSE stream died unhandled' },
  { id: 'copy falls back to a selection', needle: 'execCommand', why: 'the clipboard denied every write' },
  { id: 'repeat errors are collapsed', needle: 'lastReportedAt', why: 'one phone produced 688 identical rows' },
  // The positive marker is the modal's own failure text: it can only exist in
  // the build that saves the library row BEFORE ringing the item.
  { id: 'a refused custom item says nothing was added', needle: 'Could not save that item', why: 'a custom sale was refused as unknown' },
  { id: 'money moved is labelled in plain words', needle: 'Phone float', why: 'cash to a manager was impossible' },
  { id: 'the mobile money reference is optional in the form', needle: 'Mobile money reference', why: 'the reference was mandatory' },
  { id: 'the till float key is allowed for a seller', needle: 'eodCapital', why: "tomorrow's opening never left the phone" },
  { id: 'the sign-in screen highlights nobody', needle: 'Tap your name first', why: 'a correct PIN was checked against the wrong person' },
  { id: 'today\'s seller is offered in one tap', needle: 'Sold earlier today', why: 'the name was hunted for in a grid on every re-lock' },
];

// A needle that must NOT be there, for regressions that were deletions.
const FORBIDDEN = [
  { id: 'nothing calls the built-in flatMap', needle: '.flatMap(', why: 'flatMap is Chrome 69 and the modern floor is 64' },
  { id: 'no till-only "manager PIN" is offered', needle: 'Set This Phone', why: 'a device PIN that granted nothing' },
  // The old till-only product id is what made a custom sale unrecognisable.
  { id: 'the till-only custom product id is gone', needle: 'custom-${Date.now()}', why: 'the cart id never existed on the server' },
  { id: 'no duplicate top-up toast', needle: 'Ingredient top-up recorded', why: 'two toasts for one action' },
  { id: 'the old manager-PIN prompt is gone', needle: "title: 'Manager PIN'", why: 'collected a PIN that could not approve anything' },
];

function localChunks() {
  const dir = join(root, 'dist', 'assets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.js') && !f.includes('legacy'));
}

const localBodies = localChunks().map((f) => readFileSync(join(root, 'dist', 'assets', f), 'utf8'));
const localAll = localBodies.join('\n');

const badNeedles = [];
for (const m of MARKERS) {
  if (localAll.includes(m.needle)) continue;
  badNeedles.push(`${m.id}: "${m.needle}" is absent from the local build, so it can never match`);
}
for (const m of FORBIDDEN) {
  if (!localAll.includes(m.needle)) continue;
  badNeedles.push(`${m.id}: "${m.needle}" is present in the local build, so the regression is NOT actually gone`);
}
if (badNeedles.length) {
  console.log('The verifier itself is wrong — fix the needles before trusting it:');
  for (const b of badNeedles) console.log(`  - ${b}`);
  process.exit(1);
}

async function fetchText(path) {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.text();
}

const expected = process.argv[2] || '';
let parsed = {};
try { parsed = JSON.parse(await fetchText('/api/version')); } catch {}

console.log(`Verifying deployed artifacts on ${BASE}`);
console.log(`  server build: ${parsed.short || 'unknown'}`);
if (expected && parsed.short !== expected) {
  console.log(`\n  FAIL — server is serving ${parsed.short}, expected ${expected}`);
  process.exit(1);
}

const sw = await fetchText('/sw.js');
const names = [...new Set([...sw.matchAll(/assets\/([A-Za-z0-9_.-]+\.js)/g)].map((m) => m[1]))]
  .filter((n) => !n.includes('legacy'));
console.log(`  reading ${names.length} modern chunks from the precache manifest\n`);

const bodies = [];
for (const name of names) {
  const body = await fetchText(`/assets/${name}`).catch(() => null);
  if (body) bodies.push(body);
}
const deployed = bodies.join('\n');
console.log(`  fetched ${bodies.length} chunks, ${(deployed.length / 1024).toFixed(0)} KiB total\n`);

let failures = 0;
for (const m of MARKERS) {
  const present = deployed.includes(m.needle);
  const ok = m.invert ? !present : present;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${m.id}`);
  if (!ok) {
    console.log(`       ${m.invert ? 'still present' : 'not present'} in what phones download — ${m.why}`);
    failures += 1;
  }
}
for (const m of FORBIDDEN) {
  const ok = !deployed.includes(m.needle);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${m.id}`);
  if (!ok) { console.log(`       still present — ${m.why}`); failures += 1; }
}

console.log('');
if (failures) {
  console.log(`  ${failures} item(s) do not match what the shop is actually running.`);
  process.exit(1);
}
console.log('  PASS — the deployed artifacts match the fixes in this repository');
