import { describe, it, expect } from 'vitest';
import { parseQuantity, formatQuantity, roundMg } from './quantity';

describe('parseQuantity', () => {
  it('empty/zero forms -> 0', () => {
    expect(parseQuantity('')).toBe(0);
    expect(parseQuantity('0')).toBe(0);
    expect(parseQuantity('0,0')).toBe(0);
    expect(parseQuantity('0.0')).toBe(0);
  });

  it('unicode fractions, bare and with a leading int', () => {
    expect(parseQuantity('½')).toBe(0.5);
    expect(parseQuantity('¼')).toBe(0.25);
    expect(parseQuantity('¾')).toBe(0.75);
    expect(parseQuantity('1½')).toBe(1.5);
    expect(parseQuantity('1 ½')).toBe(1.5);
  });

  it('decimals, comma or point', () => {
    expect(parseQuantity('0,5')).toBe(0.5);
    expect(parseQuantity('0.5')).toBe(0.5);
    expect(parseQuantity('2')).toBe(2);
  });

  it('ASCII fractions, denominator 2 or 4 only, bare or mixed', () => {
    expect(parseQuantity('1/2')).toBe(0.5);
    expect(parseQuantity('3/4')).toBe(0.75);
    expect(parseQuantity('1 1/2')).toBe(1.5);
  });

  it('rejects non-numeric input', () => {
    expect(parseQuantity('abc')).toBeNull();
  });

  it('rejects thirds (no ⅓/⅔ support — repeating decimals, non-standard scoring)', () => {
    expect(parseQuantity('1/3')).toBeNull();
  });

  it('rejects a negative quantity (no matching grammar branch)', () => {
    expect(parseQuantity('-1')).toBeNull();
  });

  it('fat-finger guard: a parsed quantity over 20 is rejected', () => {
    expect(parseQuantity('21')).toBeNull();
    // JUDGMENT CALL / SPEC DEVIATION (flagged, not silently applied): the
    // spec's example test list for this file included '31.25' -> 31.25 as
    // an ACCEPTED case, but §3's own grammar rule 5 says "result>20 -> null
    // (fat-finger guard)" and separately lists '21'>20->null as a rejection.
    // 31.25 > 20 too, so accepting it would contradict the guard the spec
    // itself states two lines earlier — read as a planner slip (likely
    // meant to illustrate multi-decimal parsing, not a >20 quantity), so
    // the guard wins here and 31.25 is rejected like any other qty > 20.
    expect(parseQuantity('31.25')).toBeNull();
  });

  it('rejects a doubled fraction (not a valid grammar form)', () => {
    expect(parseQuantity('½½')).toBeNull();
  });

  it('rejects a denominator outside {2,4}', () => {
    expect(parseQuantity('1/5')).toBeNull();
  });
});

describe('formatQuantity', () => {
  it('inverts the common tablet fractions', () => {
    expect(formatQuantity(0.5)).toBe('½');
    expect(formatQuantity(1.5)).toBe('1½');
    expect(formatQuantity(0.25)).toBe('¼');
    expect(formatQuantity(0.75)).toBe('¾');
    expect(formatQuantity(2)).toBe('2');
    expect(formatQuantity(0)).toBe('0');
  });

  it('falls back to a plain decimal for a non-quarter quantity', () => {
    expect(formatQuantity(0.6)).toBe('0.6');
  });
});

describe('roundMg', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundMg(62.5)).toBe(62.5);
    expect(roundMg(0.1 + 0.2)).toBe(0.3); // classic binary-float dust
    expect(roundMg(33.333333)).toBe(33.33);
  });
});
