import { describe, expect, it } from 'vitest';
import {
  dailyShapeProgress,
  formatCheckInsLine,
  formatDailyShapeMetLine,
  formatStepsLine,
  parseDailyShapeTarget,
  serializeDailyShapeTarget,
  type DailyShapeTarget,
} from './dailyShape';

describe('serializeDailyShapeTarget / parseDailyShapeTarget — round trip', () => {
  it('round-trips a normal target', () => {
    const target: DailyShapeTarget = { checkIns: 3, steps: 6000 };
    expect(parseDailyShapeTarget(serializeDailyShapeTarget(target))).toEqual(target);
  });

  it('round-trips a target with a zero component', () => {
    const target: DailyShapeTarget = { checkIns: 0, steps: 6000 };
    expect(parseDailyShapeTarget(serializeDailyShapeTarget(target))).toEqual(target);
  });

  // Review fix (0.8.0): 0,0 is a shape with nothing in it, not a target.
  // Left parseable it rendered an emerald card headed "Today's shape" with
  // no component lines and "Today's shape is met." — an empty claim of
  // success. The parser, Settings' validation and Home now agree.
  it('refuses both components zero — a shape with nothing in it is not a target', () => {
    expect(parseDailyShapeTarget('0,0')).toBeNull();
    expect(parseDailyShapeTarget(serializeDailyShapeTarget({ checkIns: 0, steps: 0 }))).toBeNull();
  });

  it('still accepts a single zero component (that is the per-component opt-out)', () => {
    expect(parseDailyShapeTarget('0,6000')).toEqual({ checkIns: 0, steps: 6000 });
    expect(parseDailyShapeTarget('3,0')).toEqual({ checkIns: 3, steps: 0 });
  });

  it('serializes as a plain comma-joined pair', () => {
    expect(serializeDailyShapeTarget({ checkIns: 3, steps: 6000 })).toBe('3,6000');
  });
});

describe('parseDailyShapeTarget — defensive parsing', () => {
  it('returns null for undefined (row absent)', () => {
    expect(parseDailyShapeTarget(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseDailyShapeTarget('')).toBeNull();
  });

  it('returns null for whitespace only', () => {
    expect(parseDailyShapeTarget('   ')).toBeNull();
  });

  it('returns null with too few parts', () => {
    expect(parseDailyShapeTarget('3')).toBeNull();
  });

  it('returns null with too many parts', () => {
    expect(parseDailyShapeTarget('3,6000,1')).toBeNull();
  });

  it('returns null for a trailing comma (empty second segment)', () => {
    expect(parseDailyShapeTarget('3,')).toBeNull();
  });

  it('returns null for a leading comma (empty first segment)', () => {
    expect(parseDailyShapeTarget(',6000')).toBeNull();
  });

  it('returns null for a whitespace-only segment', () => {
    expect(parseDailyShapeTarget('3, ')).toBeNull();
  });

  it('returns null for non-numeric text', () => {
    expect(parseDailyShapeTarget('three,6000')).toBeNull();
  });

  it('returns null for a NaN-bearing segment, never a partial target', () => {
    const result = parseDailyShapeTarget('abc,6000');
    expect(result).toBeNull();
  });

  it('returns null for a non-integer (decimal) component', () => {
    expect(parseDailyShapeTarget('3.5,6000')).toBeNull();
  });

  it('returns null for a negative component', () => {
    expect(parseDailyShapeTarget('-1,6000')).toBeNull();
  });

  it('tolerates surrounding whitespace around otherwise-valid numbers', () => {
    expect(parseDailyShapeTarget(' 3 , 6000 ')).toEqual({ checkIns: 3, steps: 6000 });
  });

  it('never returns a NaN-bearing target', () => {
    const result = parseDailyShapeTarget('3,abc');
    if (result !== null) {
      expect(Number.isNaN(result.checkIns)).toBe(false);
      expect(Number.isNaN(result.steps)).toBe(false);
    } else {
      expect(result).toBeNull();
    }
  });
});

describe('dailyShapeProgress — zero component means opted out', () => {
  it('a zero check-ins target is always met, regardless of actual', () => {
    const progress = dailyShapeProgress({ checkIns: 0, steps: 6000 }, { checkIns: 0, steps: 6000 });
    expect(progress.checkIns.met).toBe(true);
  });

  it('a zero steps target is always met, even with null steps actual', () => {
    const progress = dailyShapeProgress({ checkIns: 3, steps: 0 }, { checkIns: 3, steps: null });
    expect(progress.steps.met).toBe(true);
    expect(progress.met).toBe(true);
  });

  it('both components zero is always fully met', () => {
    const progress = dailyShapeProgress({ checkIns: 0, steps: 0 }, { checkIns: 0, steps: null });
    expect(progress.met).toBe(true);
  });
});

describe('dailyShapeProgress — null steps reading', () => {
  it('null steps with a real target is NOT met', () => {
    const progress = dailyShapeProgress({ checkIns: 3, steps: 6000 }, { checkIns: 3, steps: null });
    expect(progress.steps.met).toBe(false);
    expect(progress.met).toBe(false);
  });

  it('null steps is distinct from zero steps — carried through as actual: null, not 0', () => {
    const progress = dailyShapeProgress({ checkIns: 3, steps: 6000 }, { checkIns: 3, steps: null });
    expect(progress.steps.actual).toBeNull();
  });
});

describe('dailyShapeProgress — met/unmet boundaries', () => {
  it('exactly at target is met (check-ins)', () => {
    const progress = dailyShapeProgress({ checkIns: 3, steps: 0 }, { checkIns: 3, steps: null });
    expect(progress.checkIns.met).toBe(true);
  });

  it('one below target is not met (check-ins)', () => {
    const progress = dailyShapeProgress({ checkIns: 3, steps: 0 }, { checkIns: 2, steps: null });
    expect(progress.checkIns.met).toBe(false);
  });

  it('one above target is met (check-ins) — never clamped', () => {
    const progress = dailyShapeProgress({ checkIns: 3, steps: 0 }, { checkIns: 4, steps: null });
    expect(progress.checkIns.met).toBe(true);
  });

  it('exactly at target is met (steps)', () => {
    const progress = dailyShapeProgress({ checkIns: 0, steps: 6000 }, { checkIns: 0, steps: 6000 });
    expect(progress.steps.met).toBe(true);
  });

  it('one below target is not met (steps)', () => {
    const progress = dailyShapeProgress({ checkIns: 0, steps: 6000 }, { checkIns: 0, steps: 5999 });
    expect(progress.steps.met).toBe(false);
  });

  it('overall met requires BOTH in-play components met', () => {
    const progress = dailyShapeProgress({ checkIns: 3, steps: 6000 }, { checkIns: 3, steps: 5999 });
    expect(progress.checkIns.met).toBe(true);
    expect(progress.steps.met).toBe(false);
    expect(progress.met).toBe(false);
  });

  it('overall met when both components clear their targets', () => {
    const progress = dailyShapeProgress({ checkIns: 3, steps: 6000 }, { checkIns: 3, steps: 6000 });
    expect(progress.met).toBe(true);
  });
});

describe('formatCheckInsLine', () => {
  it('formats a normal case', () => {
    const progress = dailyShapeProgress({ checkIns: 3, steps: 0 }, { checkIns: 2, steps: null });
    expect(formatCheckInsLine(progress.checkIns)).toBe('2 of 3 check-ins.');
  });

  it('uses singular "check-in" for a target of 1', () => {
    const progress = dailyShapeProgress({ checkIns: 1, steps: 0 }, { checkIns: 1, steps: null });
    expect(formatCheckInsLine(progress.checkIns)).toBe('1 of 1 check-in.');
  });

  it('returns null (not rendered) when the check-ins target is 0', () => {
    const progress = dailyShapeProgress({ checkIns: 0, steps: 6000 }, { checkIns: 5, steps: 6000 });
    expect(formatCheckInsLine(progress.checkIns)).toBeNull();
  });
});

describe('formatStepsLine', () => {
  it('formats a normal case with en-US thousands separators', () => {
    const progress = dailyShapeProgress({ checkIns: 0, steps: 6000 }, { checkIns: 0, steps: 4120 });
    expect(formatStepsLine(progress.steps)).toBe('4,120 of 6,000 steps.');
  });

  it('names the absent reading for a null steps value, never a bare 0, with the target last', () => {
    const progress = dailyShapeProgress({ checkIns: 0, steps: 6000 }, { checkIns: 0, steps: null });
    expect(formatStepsLine(progress.steps)).toBe('No steps reading yet — target 6,000.');
  });

  it('returns null (not rendered) when the steps target is 0', () => {
    const progress = dailyShapeProgress({ checkIns: 3, steps: 0 }, { checkIns: 3, steps: null });
    expect(formatStepsLine(progress.steps)).toBeNull();
  });

  it('formats a large target with a thousands separator', () => {
    const progress = dailyShapeProgress({ checkIns: 0, steps: 12000 }, { checkIns: 0, steps: 0 });
    expect(formatStepsLine(progress.steps)).toBe('0 of 12,000 steps.');
  });
});

describe('formatDailyShapeMetLine', () => {
  it('is calm, exact, and has no exclamation mark or emoji', () => {
    const line = formatDailyShapeMetLine();
    expect(line).toBe("Today's shape is met.");
    expect(line).not.toMatch(/!/);
  });
});
