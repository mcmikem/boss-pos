import { describe, expect, it } from 'vitest';
import { isChunkError } from './lazyRetry';

describe('isChunkError', () => {
  it('matches modern module-load failures by asset URL', () => {
    expect(
      isChunkError(
        'Failed to fetch dynamically imported module: https://imac-pos.vercel.app/assets/units-legacy-BR_JoxS4.js',
      ),
    ).toBe(true);
    expect(isChunkError('Importing a module script failed.')).toBe(false); // no asset URL
  });

  it('matches old-browser loader wording', () => {
    expect(isChunkError('Error: Unable to load /assets/Sales-legacy-abc123.js')).toBe(true);
    expect(isChunkError('Loading chunk 4 failed.')).toBe(false); // no asset URL
  });

  it('never matches real component bugs', () => {
    expect(isChunkError('Cannot read properties of undefined (reading total)')).toBe(false);
    expect(isChunkError('')).toBe(false);
  });
});
