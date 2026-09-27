import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyText } from './copy';

// The suite runs in the node environment, so the DOM surface copyText touches is
// stubbed here. What matters is the DECISION: prefer the clipboard API, fall
// back to a selection when it refuses, and never report a copy that did not
// happen. An older Android WebView has navigator.clipboard and denies every
// write, which is how "Copy support details" produced empty reports.
function fakeDom(execReturns: boolean) {
  const appended: string[] = [];
  const live: any[] = [];
  const body = {
    appendChild: (node: any) => { appended.push(String(node.value)); live.push(node); return node; },
    removeChild: (node: any) => { const i = live.indexOf(node); if (i >= 0) live.splice(i, 1); return node; },
  };
  vi.stubGlobal('document', {
    body,
    createElement: () => ({
      value: '',
      style: {} as Record<string, string>,
      select: () => {},
      setSelectionRange: () => {},
      setAttribute: () => {},
    }),
    execCommand: vi.fn().mockReturnValue(execReturns),
  });
  return { appended, live };
}

function withClipboard(writeText: (() => Promise<void>) | undefined | null) {
  vi.stubGlobal('navigator', { clipboard: writeText ? { writeText } : undefined });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('uses the clipboard API when it works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    withClipboard(writeText);
    fakeDom(true);
    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to a selection when the clipboard refuses', async () => {
    withClipboard(vi.fn().mockRejectedValue(new Error('Write permission denied.')));
    const dom = fakeDom(true);
    expect(await copyText('support details')).toBe(true);
    expect(dom.appended).toContain('support details');
    // The scratch node must not be left behind in the page.
    expect(dom.live).toHaveLength(0);
  });

  it('reports failure rather than pretending when neither path works', async () => {
    withClipboard(null);
    fakeDom(false);
    expect(await copyText('nope')).toBe(false);
  });

  it('refuses empty text instead of copying nothing successfully', async () => {
    const writeText = vi.fn();
    withClipboard(writeText);
    fakeDom(true);
    expect(await copyText('')).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('survives a browser with no document at all', async () => {
    withClipboard(null);
    vi.stubGlobal('document', undefined);
    expect(await copyText('anything')).toBe(false);
  });
});
