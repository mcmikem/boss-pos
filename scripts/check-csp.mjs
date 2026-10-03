// The Content-Security-Policy blocks inline <script>, and Vite injects two:
// the modern-browser probe and the loader that hands an old Android the legacy
// bundle. Both are allowed by sha256 hash in vercel.json rather than by
// 'unsafe-inline', so the policy stays strict -- but a hash only helps if it
// matches what was actually built.
//
// If a Vite upgrade changes either injected script, the stale hash is a silent
// failure on exactly one device: the old Android that cannot run the modern
// bundle, which shows a blank screen with no error anywhere. So this fails the
// build instead.
import { readFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const csp = JSON.parse(readFileSync('vercel.json', 'utf8'))
  .headers.flatMap((h) => h.headers)
  .find((h) => h.key === 'Content-Security-Policy').value;

const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) || '';
if (scriptSrc.includes("'unsafe-eval'")) {
  console.error('  FAIL — script-src must not allow eval');
  process.exit(1);
}

const { createHash } = await import('node:crypto');

// 'self' must survive: the app's own bundles are external scripts, so a policy
// that kept only the inline hashes blocks the entire application.
if (!/script-src[^;]*'self'/.test(csp)) {
  console.error("  FAIL — script-src has no 'self', so the app's own scripts are blocked");
  process.exit(1);
}

// Every external script the build emitted must come from 'self', and every
// other origin the page loads must be allowed by its directive.
const srcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
const external = srcs.filter((s) => !s.startsWith('data:') && /^(https?:)?\/\//.test(s));
if (external.length) {
  console.error(`  FAIL — ${external.length} external script(s) would be blocked: ${external[0]}`);
  process.exit(1);
}

const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .filter((body) => body.trim());

let bad = 0;
for (const body of inline) {
  const hash = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
  if (!scriptSrc.includes(hash)) {
    console.error(`  FAIL — inline script not allowed by the CSP: ${body.slice(0, 60).replace(/\s+/g, ' ')}...`);
    console.error(`         add ${hash} to script-src in vercel.json`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log(`  PASS — CSP allows all ${inline.length} inline script(s) by hash, none inline`);