import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReportRange } from '../api/reportRange.js';

test('normalizes absolute report boundaries and branch filters', () => {
  const range = normalizeReportRange({
    from: '2026-09-07T00:00:00.000Z',
    to: '2026-09-08T00:00:00.000Z',
    branch: 'Owino',
  });
  assert.deepEqual(range, {
    from: '2026-09-07T00:00:00.000Z',
    to: '2026-09-08T00:00:00.000Z',
    branch: 'Owino',
  });
});

test('makes a date-only upper bound inclusive for half-open queries', () => {
  assert.equal(normalizeReportRange({ from: '2026-09-07', to: '2026-09-07' }).to, '2026-09-08T00:00:00.000Z');
});

test('treats all as no branch filter', () => {
  assert.equal(normalizeReportRange({ branch: 'all' }).branch, null);
});

test('rejects invalid or reversed ranges', () => {
  assert.equal(normalizeReportRange({ from: 'not-a-date' }).error, 'Invalid from date');
  assert.equal(normalizeReportRange({ from: '2026-09-08', to: '2026-09-07' }).error, 'from must be before to');
});
