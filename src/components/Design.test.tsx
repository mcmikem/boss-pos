import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { LABELS, MoneyHero, MoneyStat, PrimaryAction, PRIMARY_ACTION_CLASS } from './Design';

describe('design system', () => {
  it('fixes one canonical word per concept, with no banned synonyms', () => {
    expect(LABELS.tookToday).toBe('Took today');
    expect(LABELS.expectedInDrawer).toBe('Expected in drawer');
    expect(LABELS.notYetAssigned).toBe('Not yet assigned');
    expect(LABELS.awaitingConfirmation).toBe('Awaiting confirmation');
    expect(LABELS.moneyOnShelves).toBe('Money on shelves');
    expect(LABELS.notSelling).toBe('Not selling');
    for (const label of Object.values(LABELS)) {
      expect(label).not.toMatch(/unaccounted|still out|accounted for/i);
      expect(label).not.toBe('Collected today');
    }
  });

  it('renders the hero visibly larger than supporting figures', () => {
    const hero = renderToString(React.createElement(MoneyHero, { label: 'Money on shelves', value: 'USh 1,200,000' }));
    expect(hero).toContain('Money on shelves');
    expect(hero).toContain('USh 1,200,000');
    expect(hero).toContain('text-[28px]');
    const stat = renderToString(React.createElement(MoneyStat, { label: 'Low stock', value: '3' }));
    expect(stat).toContain('text-base');
    expect(stat).not.toContain('text-[28px]');
  });

  it('renders numbers tabular so columns never jitter', () => {
    const html = renderToString(React.createElement(MoneyHero, { label: 'X', value: '1' }));
    expect(html).toContain('tabular-nums');
  });

  it('keeps one gold full-width primary action contract', () => {
    expect(PRIMARY_ACTION_CLASS).toContain('bg-gold-brand');
    expect(PRIMARY_ACTION_CLASS).toContain('w-full');
    expect(PRIMARY_ACTION_CLASS).toContain('h-12');
    const html = renderToString(React.createElement(PrimaryAction, { children: 'Close day' }));
    expect(html).toContain('Close day');
    expect(html).toContain('bg-gold-brand');
  });
});
