import { describe, expect, it } from 'vitest';
import { parseCsv, parseProductsCsv } from './csvImport';

describe('parseCsv', () => {
  it('handles quotes, commas and CRLF', () => {
    const rows = parseCsv('name,price\r\n"Sugar, 1kg",5000\r\nChapati,1000\r\n');
    expect(rows).toEqual([['name', 'price'], ['Sugar, 1kg', '5000'], ['Chapati', '1000']]);
  });

  it('handles escaped quotes and newlines inside fields', () => {
    const rows = parseCsv('a,b\n"He said ""hi""\nok",2\n');
    expect(rows[1][0]).toBe('He said "hi"\nok');
  });

  it('never throws on garbage', () => {
    expect(() => parseCsv('"""unclosed,still')).not.toThrow();
  });
});

describe('parseProductsCsv', () => {
  const good = 'name,category,cost,price,stock,low_threshold\nSugar,Groceries,4500,5000,20,5\n';

  it('parses a clean sheet', () => {
    const r = parseProductsCsv(good, 'General');
    expect(r.errors).toEqual([]);
    expect(r.products).toHaveLength(1);
    expect(r.products[0]).toMatchObject({ name: 'Sugar', category: 'Groceries', cost: 4500, price: 5000, stockQty: 20, lowStockThreshold: 5 });
  });

  it('accepts aliases and falls back to category and cost', () => {
    const r = parseProductsCsv('Item,Dept,Buy\nRope,Hardware,2000\n', 'General');
    expect(r.products[0]).toMatchObject({ name: 'Rope', category: 'Hardware', price: 2000 });
    const r2 = parseProductsCsv('name,price\nAirtime,0\n', 'General');
    expect(r2.products).toHaveLength(0);
    expect(r2.errors.length).toBeGreaterThan(0);
  });

  it('rejects a missing header with guidance', () => {
    const r = parseProductsCsv('Sugar,5000\nSalt,3000\n', 'General');
    expect(r.products).toHaveLength(0);
    expect(r.errors[0]).toContain('headings');
  });

  it('reports bad rows with line numbers and keeps the good ones', () => {
    const r = parseProductsCsv('name,price\nGood,1000\n,500\nPriceless,\n', 'General');
    expect(r.products.map(p => p.name)).toEqual(['Good']);
    expect(r.errors.join('|')).toContain('Row 3');
    expect(r.errors.join('|')).toContain('Row 4');
  });

  it('rejects an empty file with guidance', () => {
    expect(parseProductsCsv('   \n', 'General').errors[0]).toContain('empty');
  });
});
