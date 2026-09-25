import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');
const swPath = resolve(dist, 'sw.js');
const indexPath = resolve(dist, 'index.html');

const limits = Object.freeze({
  modernInitialJs: 850_000,
  legacyInitialJs: 1_200_000,
  largestJs: 900_000,
  allJs: 4_500_000,
  precache: 4_500_000,
});

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap(entry => {
      const absolute = resolve(directory, entry.name);
      return entry.isDirectory() ? walk(absolute) : [absolute];
    });
}

function localPath(value) {
  const clean = value.split(/[?#]/, 1)[0].replace(/^\/+/, '');
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

function referencedPaths(html) {
  const references = [];
  const patterns = [
    /<script\b[^>]*\bsrc=["']([^"']+)["']/gi,
    /<link\b[^>]*\bhref=["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      if (!/^(?:[a-z]+:|\/\/|#)/i.test(match[1])) references.push(localPath(match[1]));
    }
  }
  return [...new Set(references)].sort();
}

function entryPaths(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => localPath(match[1]));
  const modulePreloads = [...html.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+)["']/gi)].map(match => localPath(match[1]));
  const modernEntry = scripts.find(file => /\/assets\/index-[^/]+\.js$/.test(file) && !file.includes('-legacy-'));
  const legacyEntry = scripts.find(file => /\/assets\/index-[^/]+\.js$/.test(file) && file.includes('-legacy-'));
  const modern = [modernEntry, ...scripts.filter(file => !file.includes('-legacy-')), ...modulePreloads.filter(file => !file.includes('-legacy-'))]
    .filter(Boolean)
    .filter((file, index, all) => all.indexOf(file) === index);
  const legacy = [legacyEntry, ...scripts.filter(file => file.includes('-legacy-')), ...modulePreloads.filter(file => file.includes('-legacy-'))]
    .filter(Boolean)
    .filter((file, index, all) => all.indexOf(file) === index);
  return { modern, legacy };
}

function precacheEntries(sw) {
  return [...sw.matchAll(/url:["']((?:\\.|[^"'])*)["']/g)].map(item => item[1].replace(/\\(["'\\])/g, '$1'));
}

if (!existsSync(dist) || !existsSync(indexPath) || !existsSync(swPath)) {
  console.error('Build budget failed: run vite build before checking the bundle.');
  process.exitCode = 1;
} else {
  const files = walk(dist);
  const fileSet = new Set(files.map(file => relative(dist, file).split('\\').join('/')));
  const sizes = new Map(files.map(file => [relative(dist, file).split('\\').join('/'), statSync(file).size]));
  const html = readFileSync(indexPath, 'utf8');
  const sw = readFileSync(swPath, 'utf8');
  const entries = entryPaths(html);
  const precache = [...new Set(precacheEntries(sw))].sort();
  const missingReferences = referencedPaths(html).filter(file => !fileSet.has(file));
  const missingPrecache = precache.filter(file => !fileSet.has(file));
  const modernBytes = entries.modern.reduce((sum, file) => sum + (sizes.get(file) || 0), 0);
  const legacyBytes = entries.legacy.reduce((sum, file) => sum + (sizes.get(file) || 0), 0);
  const allJsBytes = [...sizes.entries()].filter(([file]) => file.endsWith('.js')).reduce((sum, [, size]) => sum + size, 0);
  const largestJs = Math.max(0, ...[...sizes.entries()].filter(([file]) => file.endsWith('.js')).map(([, size]) => size));
  const precacheBytes = precache.reduce((sum, file) => sum + (sizes.get(file) || 0), 0);
  const failures = [];

  if (entries.modern.length === 0) failures.push('modern entry script is missing');
  if (entries.legacy.length === 0) failures.push('legacy entry script is missing');
  if (missingReferences.length > 0) failures.push(`missing HTML references: ${missingReferences.join(', ')}`);
  if (missingPrecache.length > 0) failures.push(`missing precache files: ${missingPrecache.join(', ')}`);
  if (fileSet.has('registerSW.js')) failures.push('registerSW.js must not be emitted');
  if (precache.length === 0) failures.push('service worker precache manifest is empty');
  if (!/skipWaiting/.test(sw) || !/clients\.claim/.test(sw)) failures.push('service worker update policy is incomplete');
  if (!/\/api\//.test(sw) || !/networkTimeoutSeconds/.test(sw)) failures.push('service worker cache policy is incomplete');
  if (/=>/.test(sw) || /\b(?:const|let)\s/.test(sw) || /`/.test(sw)) failures.push('service worker is not downleveled');
  if (modernBytes > limits.modernInitialJs) failures.push(`modern initial JavaScript is ${modernBytes} bytes`);
  if (legacyBytes > limits.legacyInitialJs) failures.push(`legacy initial JavaScript is ${legacyBytes} bytes`);
  if (largestJs > limits.largestJs) failures.push(`largest JavaScript file is ${largestJs} bytes`);
  if (allJsBytes > limits.allJs) failures.push(`all JavaScript is ${allJsBytes} bytes`);
  if (precacheBytes > limits.precache) failures.push(`precache is ${precacheBytes} bytes`);

  const format = value => `${(value / 1024).toFixed(1)} KiB`;
  console.log('Build budget');
  console.log(`  modern initial JS: ${format(modernBytes)} / ${format(limits.modernInitialJs)}`);
  console.log(`  legacy initial JS: ${format(legacyBytes)} / ${format(limits.legacyInitialJs)}`);
  console.log(`  largest JS: ${format(largestJs)} / ${format(limits.largestJs)}`);
  console.log(`  all JS: ${format(allJsBytes)} / ${format(limits.allJs)}`);
  console.log(`  precache: ${format(precacheBytes)} / ${format(limits.precache)} (${precache.length} files)`);
  if (failures.length > 0) {
    failures.forEach(failure => console.error(`  FAIL ${failure}`));
    process.exitCode = 1;
  } else {
    console.log('  PASS');
  }
}
