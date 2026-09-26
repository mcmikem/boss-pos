import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import DepartmentToday from './DepartmentToday';
import { getDepartment, shelfStats } from './departmentRegistry';

describe('DepartmentToday render', () => {
  it('opens every department on state first, never a bare grid', () => {
    const html = renderToString(
      React.createElement(DepartmentToday, {
        config: getDepartment('Electronics'),
        stats: [
          { label: 'Sold today', value: 'USh 25,000', tone: 'gold' },
          { label: 'Money on shelves', value: 'USh 400,000', tone: 'white' },
          { label: 'Low stock', value: '2', tone: 'rose' },
        ],
      }),
    );
    expect(html).toContain('Today — Electronics');
    expect(html).toContain('USh 25,000');
    expect(html).toContain('Money on shelves');
  });

  it('falls back to a working shelf for unknown categories', () => {
    const config = getDepartment('Boutique');
    expect(config.kind).toBe('sell');
    const html = renderToString(
      React.createElement(DepartmentToday, { config, stats: shelfStats('Boutique', [], [], (n) => `USh ${n}`) }),
    );
    expect(html).toContain('Today — Boutique');
  });
});
