import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import StaffSwitcher from './StaffSwitcher';
import type { StaffMember } from '../types';

const staff: StaffMember[] = [
  { id: 'st-1', name: 'DIANAH', role: 'manager', active: true, hasPin: true },
  { id: 'st-2', name: 'LILLIAN', role: 'cashier', active: true, hasPin: true },
  { id: 'st-3', name: 'MCMIKE', role: 'manager', active: true, hasPin: true },
  { id: 'st-4', name: 'SANDRA', role: 'cashier', active: true, hasPin: true },
  { id: 'st-5', name: 'YAWE', role: 'cashier', active: true, hasPin: true },
];

const html = (today?: { id: string; name: string } | null) =>
  renderToString(
    React.createElement(StaffSwitcher, {
      staff, mandatory: true, verifying: false, error: null,
      onVerify: () => {}, onClose: () => {}, today,
    }),
  );

// A nested scroll box inside a modal is how names go missing on a phone: the
// card scrolls, so the box "hiding" rows is not obvious and there is no cue.
function assertNoInnerScroll(page: string) {
  const grids = page.match(/<div class="grid grid-cols-2[^"]*"/g) || [];
  for (const g of grids) {
    if (/max-h-\[|overflow-y-auto/.test(g)) {
      throw new Error(`the names grid still scrolls inside the card: ${g}`);
    }
  }
}

describe('the sign-in screen must not lie about who you are', () => {
  it('highlights NOBODY until the seller taps their own name', () => {
    // It used to highlight the oldest account, so a correct PIN under the wrong
    // highlighted name came back as "Wrong PIN" — about the wrong person.
    const page = html();
    expect(page).not.toContain('border-gold-brand bg-gold-brand/10 text-white');
    expect(page).toContain('Tap your name first');
  });

  it('lists people alphabetically, not by join date', () => {
    const page = html();
    expect(page.indexOf('LILLIAN')).toBeLessThan(page.indexOf('YAWE'));
  });

  it('EVERY name is in the page, none of them hidden below a fold', () => {
    // "Their names do not show on the login page" was a 32vh inner scroll: the
    // last row of names sat under the bottom of a small screen with nothing to
    // suggest there was more. Every person on the till must appear in the HTML.
    const page = html();
    for (const person of staff) expect(page).toContain(person.name);
    assertNoInnerScroll(page);
  });

  it('every name still shows when someone is offered back', () => {
    const page = html({ id: 'st-5', name: 'YAWE' });
    for (const person of staff) expect(page).toContain(person.name);
    assertNoInnerScroll(page);
  });

  it('offers this morning\'s seller in one tap, PIN still required', () => {
    const page = html({ id: 'st-2', name: 'LILLIAN' });
    expect(page).toMatch(/LILLIAN<!-- --> again/);
    expect(page).toContain('Sold earlier today');
    // And she is lifted out of the grid, not repeated in it.
    expect(page.match(/LILLIAN/g)?.length).toBe(1);
    // The shortcut is to the NAME. The PIN is still what proves it: an empty
    // 4-digit box, and "Start selling" stays dead until it is typed.
    expect(page).toMatch(/type="password" inputMode="numeric" maxLength="4"/);
    expect(page).toMatch(/<button disabled=""[^>]*>Start selling/);
  });

  it('does not offer someone who is not on the active list any more', () => {
    const page = html({ id: 'st-9', name: 'GONE' });
    expect(page).not.toContain('again');
  });
});
