import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import ProductCard from './ProductCard';
import type { Product } from '../types';

const fmt = (n: number) => `${n}`;

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', name: 'Chapati', category: 'Eatery', cost: 100, price: 500, stockQty: 20,
    lowStockThreshold: 5, isService: false, ...over,
  } as Product;
}

const card = (p: Product) =>
  renderToString(React.createElement(ProductCard, {
    product: p, cart: [], formatCurrency: fmt, onAddToCart: () => {}, simple: true,
  }));

describe('the card tells you what is behind the tap', () => {
  it('shows a plain price when there is one price', () => {
    expect(card(product())).toContain('500');
  });

  it('shows the RANGE for options, not "500+"', () => {
    // "500+" told the seller nothing about what was behind the tap.
    const html = card(product({
      price: 500,
      variants: [
        { id: 'v1', label: 'Big', price: 1000, cost: 850 },
        { id: 'v2', label: 'Small', price: 500, cost: 350 },
      ] as never,
    }));
    expect(html).toContain('500–1000');
    expect(html).not.toContain('500+');
  });

  it('reads as a plain price when every option costs the same', () => {
    const html = card(product({
      price: 500,
      variants: [
        { id: 'v1', label: 'Red', price: 500 },
        { id: 'v2', label: 'Blue', price: 500 },
      ] as never,
    }));
    expect(html).toContain('500');
    expect(html).not.toContain('500–500');
  });
});
