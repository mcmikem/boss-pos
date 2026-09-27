// Answers ONE question and prints NO pin: for every 4-digit candidate, which
// accounts does it unlock? Each row has its own salt, so identical PINs have
// different hashes — the only way to know who shares a PIN is to try all 10,000
// and look at the pattern. Digits are never printed or stored.
import { readFileSync } from 'node:fs';
import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const env = readFileSync('/Users/me/Downloads/boss-pos/.env', 'utf8');
const DATABASE_URL = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).slice(13).trim().replace(/^["']|["']$/g, '');
const sql = neon(DATABASE_URL);
const rows = await sql`SELECT id, name, role, active, pin_hash FROM staff`;

const verify = (stored, pin) => {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 4) return false;
  const [, iterStr, salt, hex] = parts;
  const iter = parseInt(iterStr, 10);
  if (!iter || iter < 1 || iter > 1_000_000) return false;
  const computed = pbkdf2Sync(String(pin), salt, iter, 32, 'sha256').toString('hex');
  const a = Buffer.from(hex, 'hex');
  const b = Buffer.from(computed, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

const tally = new Map();
for (let n = 0; n < 10000; n++) {
  const pin = String(n).padStart(4, '0');
  const hit = rows.filter(r => verify(r.pin_hash, pin));
  if (!hit.length) continue;
  const key = hit.map(r => `${r.name}${r.active ? '' : '(off)'}`).sort().join(' + ');
  tally.set(key, (tally.get(key) || 0) + 1);
}

console.log('accounts on the till:', rows.length);
console.log('\nEvery PIN in use, and who it opens:');
for (const [who, count] of tally) console.log(`  ${String(count).padStart(4)} PIN(s) -> ${who}`);

const yawe = rows.find(r => r.name === 'YAWE' && r.active);
const soloYawe = [...tally.entries()].filter(([k]) => k === 'YAWE');
console.log('\nYAWE (active) has a PIN of her own alone:', soloYawe.length === 1 ? 'YES' : 'NO');
const shared = [...tally.entries()].filter(([k]) => k.split(' + ').length > 1);
console.log('PINs shared by more than one person:', shared.length ? shared.map(([k, c]) => `${k} (${c})`).join('; ') : 'none');
