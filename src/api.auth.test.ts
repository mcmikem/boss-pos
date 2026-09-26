import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  productApi, tokenExpired, setStaffToken, setAuthToken, getStaffToken, getAuthToken,
} from './api';

const store = new Map<string, string>();
const dispatched: string[] = [];

function tokenWithExp(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp, v: 0, role: 'manager', staffId: 's-1' })).toString('base64url');
  return `${payload}.sig`;
}

function unauthorized() {
  return {
    ok: false,
    status: 401,
    headers: { get: () => null },
    json: async () => ({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }),
  };
}

beforeEach(() => {
  store.clear();
  dispatched.length = 0;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
  });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('window', {
    dispatchEvent: (e: Event) => { dispatched.push(e.type); return true; },
    setTimeout,
    clearTimeout,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tokenExpired', () => {
  it('reads the expiry straight from the token payload', () => {
    expect(tokenExpired(tokenWithExp(Date.now() - 1000))).toBe(true);
    expect(tokenExpired(tokenWithExp(Date.now() + 3600_000))).toBe(false);
    expect(tokenExpired('garbage')).toBe(true);
    expect(tokenExpired(null)).toBe(true);
  });
});

describe('401 handling', () => {
  it('drops only the provably-expired staff credential and never re-locks a live till', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unauthorized()));
    setStaffToken(tokenWithExp(Date.now() - 1000));
    const till = tokenWithExp(Date.now() + 3600_000);
    setAuthToken(till);
    await expect(productApi.list()).rejects.toThrow();
    expect(getStaffToken()).toBeNull();
    expect(getAuthToken()).toBe(till);
    expect(dispatched).toContain('boss-pos-staff-revoked');
    expect(dispatched).not.toContain('boss-pos-auth-revoked');
  });

  it('re-locks when the expired staff token was the only credential', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unauthorized()));
    setStaffToken(tokenWithExp(Date.now() - 1000));
    await expect(productApi.list()).rejects.toThrow();
    expect(getStaffToken()).toBeNull();
    expect(getAuthToken()).toBeNull();
    expect(dispatched).toContain('boss-pos-auth-revoked');
  });

  it('treats one 401 against live credentials as transient, two as a real revoke', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unauthorized()));
    const live = tokenWithExp(Date.now() + 3600_000);
    setAuthToken(live);
    await expect(productApi.list()).rejects.toThrow();
    expect(getAuthToken()).toBe(live);
    expect(dispatched).not.toContain('boss-pos-auth-revoked');
    await expect(productApi.list()).rejects.toThrow();
    expect(getAuthToken()).toBeNull();
    expect(dispatched).toContain('boss-pos-auth-revoked');
  });
});
