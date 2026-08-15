// PIN hashing.
//
// The server stores PINs as salted PBKDF2 (`pbkdf2$<iterations>$<salt>$<hex>`).
// This module lets the client reproduce the same derivation so offline unlock
// keeps working. A pure-JS SHA-256/HMAC/PBKDF2 fallback covers old Android
// WebViews whose WebCrypto (crypto.subtle) lacks PBKDF2 (Chrome < 58).

function utf8Bytes(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const buf = unescape(encodeURIComponent(s));
  const out = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf.charCodeAt(i);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

// --- Pure-JS SHA-256 ---
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Block(h: number[], m: Uint8Array): void {
  const w = new Array(64);
  for (let i = 0; i < 16; i++) {
    w[i] = (m[i * 4] << 24) | (m[i * 4 + 1] << 16) | (m[i * 4 + 2] << 8) | m[i * 4 + 3];
  }
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
    const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
  }
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (let i = 0; i < 64; i++) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    hh = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
  h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
}

function sha256Sync(data: Uint8Array): Uint8Array {
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bitLen = data.length * 8;
  const withOne = new Uint8Array(data.length + 1);
  withOne.set(data);
  withOne[data.length] = 0x80;
  const total = Math.ceil((withOne.length + 8) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(withOne);
  const dv = new DataView(padded.buffer);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(total - 4, bitLen >>> 0);
  for (let off = 0; off < total; off += 64) {
    sha256Block(H, padded.subarray(off, off + 64));
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (H[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    out[i * 4 + 3] = H[i] & 0xff;
  }
  return out;
}

// --- Pure-JS HMAC-SHA256 ---
function hmacSha256Sync(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const blockSize = 64;
  let k = key;
  if (k.length > blockSize) k = sha256Sync(k);
  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  ipad.fill(0x36);
  opad.fill(0x5c);
  for (let i = 0; i < k.length; i++) {
    ipad[i] ^= k[i];
    opad[i] ^= k[i];
  }
  const inner = new Uint8Array(ipad.length + msg.length);
  inner.set(ipad);
  inner.set(msg, ipad.length);
  const innerHash = sha256Sync(inner);
  const outer = new Uint8Array(opad.length + innerHash.length);
  outer.set(opad);
  outer.set(innerHash, opad.length);
  return sha256Sync(outer);
}

// --- Pure-JS PBKDF2-HMAC-SHA256 ---
function pbkdf2Sync(password: Uint8Array, salt: Uint8Array, iterations: number, dkLen = 32): Uint8Array {
  const hLen = 32;
  const numBlocks = Math.ceil(dkLen / hLen);
  const out = new Uint8Array(numBlocks * hLen);
  const saltPlus = new Uint8Array(salt.length + 4);
  saltPlus.set(salt);
  for (let block = 1; block <= numBlocks; block++) {
    saltPlus[salt.length] = (block >>> 24) & 0xff;
    saltPlus[salt.length + 1] = (block >>> 16) & 0xff;
    saltPlus[salt.length + 2] = (block >>> 8) & 0xff;
    saltPlus[salt.length + 3] = block & 0xff;
    let u = hmacSha256Sync(password, saltPlus);
    const t = u.slice();
    for (let i = 1; i < iterations; i++) {
      u = hmacSha256Sync(password, u);
      for (let j = 0; j < hLen; j++) t[j] ^= u[j];
    }
    out.set(t, (block - 1) * hLen);
  }
  return out.subarray(0, dkLen);
}

// Legacy single SHA-256 of the PIN (pre-PBKDF2). Only used for the very first
// offline unlock on a device that has never fetched a strong hash.
export async function hashPin(pin: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', utf8Bytes(pin));
      return toHex(new Uint8Array(hashBuffer));
    }
  } catch {}
  return toHex(sha256Sync(utf8Bytes(pin)));
}

// Derive the PBKDF2 hash matching the server's `pbkdf2$iter$salt$hex` format.
export async function derivePinHash(pin: string, salt: string, iterations: number): Promise<string> {
  const iter = Math.min(Math.max(1, iterations | 0), 1_000_000);
  try {
    if (
      typeof crypto !== 'undefined' && crypto.subtle &&
      typeof crypto.subtle.importKey === 'function' && typeof crypto.subtle.deriveBits === 'function'
    ) {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations: iter, hash: 'SHA-256' },
        keyMaterial, 256,
      );
      return toHex(new Uint8Array(bits));
    }
  } catch {}
  return toHex(pbkdf2Sync(utf8Bytes(pin), utf8Bytes(salt), iter, 32));
}

// Verify a PIN against a stored server hash (pbkdf2 or legacy sha256).
export async function verifyPinAgainstHash(pin: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith('pbkdf2$')) {
    const parts = stored.split('$');
    if (parts.length !== 4) return false;
    const [, iterStr, salt, hex] = parts;
    const derived = await derivePinHash(pin, salt, parseInt(iterStr, 10));
    return derived === hex;
  }
  const legacy = await hashPin(pin);
  return legacy === stored;
}
