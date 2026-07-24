import { describe, expect, it } from 'vitest';
import { parseWeeklyRrule } from './rrule';

describe('parseWeeklyRrule', () => {
  it('parses a single-day weekly rule (the field report #10 case: every Friday)', () => {
    expect(parseWeeklyRrule('FREQ=WEEKLY;BYDAY=FR')).toEqual({ days: [5] });
  });

  it('parses multiple days, sorted Monday-first regardless of BYDAY order', () => {
    expect(parseWeeklyRrule('FREQ=WEEKLY;BYDAY=FR,MO,WE')).toEqual({ days: [1, 3, 5] });
  });

  it('is case-insensitive', () => {
    expect(parseWeeklyRrule('freq=weekly;byday=mo,we,fr')).toEqual({ days: [1, 3, 5] });
  });

  it('is tolerant of parameter order — BYDAY before FREQ', () => {
    expect(parseWeeklyRrule('BYDAY=TU;FREQ=WEEKLY')).toEqual({ days: [2] });
  });

  it('accepts an explicit INTERVAL=1', () => {
    expect(parseWeeklyRrule('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO')).toEqual({ days: [1] });
  });

  it('rejects INTERVAL>1 — this app has no "every other week" field to hold it', () => {
    expect(parseWeeklyRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')).toBeNull();
  });

  it('rejects a non-WEEKLY FREQ', () => {
    expect(parseWeeklyRrule('FREQ=DAILY')).toBeNull();
    expect(parseWeeklyRrule('FREQ=MONTHLY;BYDAY=1MO')).toBeNull();
  });

  it('returns null when BYDAY is absent — honest, not a DTSTART-weekday guess', () => {
    expect(parseWeeklyRrule('FREQ=WEEKLY')).toBeNull();
  });

  it('returns null for a null input', () => {
    expect(parseWeeklyRrule(null)).toBeNull();
  });

  it('returns null for an empty or unparseable string', () => {
    expect(parseWeeklyRrule('')).toBeNull();
    expect(parseWeeklyRrule('not an rrule at all')).toBeNull();
  });

  it('returns null when a BYDAY code is unrecognized', () => {
    expect(parseWeeklyRrule('FREQ=WEEKLY;BYDAY=MO,XX')).toBeNull();
  });

  it('de-duplicates a repeated day code', () => {
    expect(parseWeeklyRrule('FREQ=WEEKLY;BYDAY=MO,MO,WE')).toEqual({ days: [1, 3] });
  });

  it('strips a monthly-style ordinal prefix from a BYDAY code defensively', () => {
    expect(parseWeeklyRrule('FREQ=WEEKLY;BYDAY=1MO')).toEqual({ days: [1] });
  });

  it('tolerates surrounding whitespace around segments and values', () => {
    expect(parseWeeklyRrule(' FREQ=WEEKLY ; BYDAY = MO , FR ')).toEqual({ days: [1, 5] });
  });
});
