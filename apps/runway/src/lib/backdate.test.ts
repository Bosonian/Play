import { describe, expect, it } from 'vitest';
import { clampBackdate, hhmmToDateNear } from './backdate';

describe('clampBackdate', () => {
  const lowerBound = new Date('2026-07-09T08:00:00.000Z');
  const now = new Date('2026-07-09T08:30:00.000Z');

  it('accepts a chosen instant strictly between the bounds', () => {
    const chosen = new Date('2026-07-09T08:15:00.000Z');
    expect(clampBackdate(chosen, lowerBound, now)).toEqual({ ok: true, at: chosen });
  });

  it('accepts a chosen instant exactly equal to lowerBound (inclusive - simultaneous is legitimate)', () => {
    const chosen = new Date(lowerBound);
    expect(clampBackdate(chosen, lowerBound, now)).toEqual({ ok: true, at: chosen });
  });

  it('accepts a chosen instant exactly equal to now (inclusive - "just now" is not backdating)', () => {
    const chosen = new Date(now);
    expect(clampBackdate(chosen, lowerBound, now)).toEqual({ ok: true, at: chosen });
  });

  it('rejects a chosen instant before lowerBound as before-previous', () => {
    const chosen = new Date('2026-07-09T07:59:00.000Z');
    expect(clampBackdate(chosen, lowerBound, now)).toEqual({ ok: false, reason: 'before-previous' });
  });

  it('rejects a chosen instant after now as in-future', () => {
    const chosen = new Date('2026-07-09T08:31:00.000Z');
    expect(clampBackdate(chosen, lowerBound, now)).toEqual({ ok: false, reason: 'in-future' });
  });
});

describe('hhmmToDateNear', () => {
  const reference = new Date('2026-07-09T08:30:00.000Z');

  it('keeps today\'s date when the time-of-day is at or before the reference', () => {
    const result = hhmmToDateNear('08:15', reference);
    expect(result.toISOString()).toBe('2026-07-09T08:15:00.000Z');
  });

  it('is inclusive at the exact reference instant - stays today, does not roll back', () => {
    const result = hhmmToDateNear('08:30', reference);
    expect(result.toISOString()).toBe('2026-07-09T08:30:00.000Z');
  });

  it('rolls BACKWARD one day when the time-of-day is still ahead of the reference (mirror of nextOccurrenceOf rolling forward)', () => {
    const result = hhmmToDateNear('23:50', reference);
    expect(result.toISOString()).toBe('2026-07-08T23:50:00.000Z');
  });

  it('rolls back across a month boundary correctly', () => {
    const firstOfMonth = new Date('2026-08-01T00:10:00.000Z');
    const result = hhmmToDateNear('23:59', firstOfMonth);
    expect(result.toISOString()).toBe('2026-07-31T23:59:00.000Z');
  });

  it('returns an Invalid Date for unparseable input', () => {
    expect(Number.isNaN(hhmmToDateNear('not-a-time', reference).getTime())).toBe(true);
  });

  it('returns an Invalid Date for empty input', () => {
    expect(Number.isNaN(hhmmToDateNear('', reference).getTime())).toBe(true);
  });
});
