import { describe, expect, it } from 'vitest';
import { isOn, FEATURES } from './features';

describe('isOn', () => {
  it('defaults every feature ON until the shop turns it off', () => {
    for (const f of FEATURES) {
      expect(isOn(undefined, f.key)).toBe(true);
      expect(isOn({}, f.key)).toBe(true);
      expect(isOn({ [f.key]: false }, f.key)).toBe(false);
      expect(isOn({ [f.key]: true }, f.key)).toBe(true);
    }
  });
});
