import { describe, it, expect } from 'vitest';
import { mergeEvents, type PatientEvent } from './types';

const ev = (id: string, at: string): PatientEvent => ({
  id,
  patient: 'P-01',
  at,
  kind: 'motor',
  state: 'off',
});

describe('mergeEvents — idempotent store-and-forward merge', () => {
  it('merges disjoint sets and sorts chronologically', () => {
    const a = [ev('1', '2026-07-16T08:00:00Z')];
    const b = [ev('2', '2026-07-16T07:00:00Z')];
    const merged = mergeEvents(a, b);
    expect(merged.map((e) => e.id)).toEqual(['2', '1']);
  });

  it('is idempotent: re-syncing the same events adds no duplicates', () => {
    const existing = [ev('1', '2026-07-16T08:00:00Z')];
    const incoming = [ev('1', '2026-07-16T08:00:00Z'), ev('2', '2026-07-16T09:00:00Z')];
    const once = mergeEvents(existing, incoming);
    const twice = mergeEvents(once, incoming); // retry the same bundle
    expect(twice).toHaveLength(2);
    expect(twice.map((e) => e.id)).toEqual(['1', '2']);
  });
});
