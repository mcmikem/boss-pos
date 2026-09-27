import { describe, it, expect } from 'vitest';
import { flatMap } from './arrays';

// flatMap is Chrome 69. The modern bundle starts at Chrome 64, so relying on it
// risks a crash on the sell screen. This is the written-out version.
describe('flatMap', () => {
  it('flattens one level, like the built-in', () => {
    expect(flatMap([1, 2, 3], (n) => [n, n * 10])).toEqual([1, 10, 2, 20, 3, 30]);
  });

  it('does not flatten deeply — one level only', () => {
    expect(flatMap([1], () => [[1], [2]])).toEqual([[1], [2]]);
  });

  it('keeps empty results and skips null/undefined projections', () => {
    expect(flatMap([1, 2, 3], (n) => (n === 2 ? null : n === 3 ? undefined : [n]))).toEqual([1]);
  });

  it('tolerates a missing list, which is what the callers pass on first boot', () => {
    expect(flatMap(null, () => [1])).toEqual([]);
    expect(flatMap(undefined, () => [1])).toEqual([]);
    expect(flatMap([], () => [1])).toEqual([]);
  });

  it('passes the index through', () => {
    expect(flatMap(['a', 'b'], (_, i) => [i])).toEqual([0, 1]);
  });
});
