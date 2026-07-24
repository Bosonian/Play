import { describe, expect, it } from 'vitest';
import {
  formatAppointmentLine,
  formatCountdown,
  formatDateLong,
  formatDateMedium,
  formatExamAnchorLine,
  formatExamMarginLine,
  formatRequiredPaceLine,
  formatScheduleDays,
  formatSlackLine,
} from './format';

describe('formatSlackLine', () => {
  it('plain minutes, ahead of schedule', () => {
    expect(formatSlackLine(23)).toBe('23 min of slack');
  });

  it('plain minutes, past the appointment', () => {
    expect(formatSlackLine(-8)).toBe('8 min past your appointment');
  });

  it('switches to hours+minutes once the magnitude reaches 120', () => {
    // 14 h 0 min — the exact case named in the finding: "14 h 0 min of
    // slack" is the un-fixed reading this formatter replaces.
    expect(formatSlackLine(840)).toBe('14h 0m of slack');
    expect(formatSlackLine(-125)).toBe('2h 5m past your appointment');
    // Boundary: 119 stays in plain-minutes form, 120 switches.
    expect(formatSlackLine(119)).toBe('119 min of slack');
    expect(formatSlackLine(120)).toBe('2h 0m of slack');
  });
});

describe('formatAppointmentLine', () => {
  it('same calendar day: time only, no date prefix', () => {
    const now = new Date('2026-07-09T06:00:00.000Z');
    const appointmentAt = new Date('2026-07-09T14:30:00.000Z');
    expect(formatAppointmentLine(appointmentAt, now)).toBe('Appointment 14:30');
  });

  it('different calendar day: date prefix included', () => {
    const now = new Date('2026-07-09T06:00:00.000Z');
    const appointmentAt = new Date('2026-07-10T14:30:00.000Z');
    expect(formatAppointmentLine(appointmentAt, now)).toBe('Appointment Fri 10 Jul 14:30');
  });
});

describe('formatDateLong', () => {
  it('day, short month, full year', () => {
    expect(formatDateLong(new Date('2026-11-01T00:00:00'))).toBe('1 Nov 2026');
  });
});

describe('formatExamAnchorLine', () => {
  it('anchors to the window start before an exact date is known', () => {
    expect(formatExamAnchorLine({ windowStart: '2026-11-01', examDate: null })).toBe(
      'Exam window opens 1 Nov 2026',
    );
  });

  it('anchors to the exact date once it is set, dropping "window opens"', () => {
    expect(formatExamAnchorLine({ windowStart: '2026-11-01', examDate: '2026-11-14' })).toBe(
      'Exam 14 Nov 2026',
    );
  });
});

describe('formatDateMedium', () => {
  it('day and short month, no weekday, no year when the year matches `now`', () => {
    const now = new Date('2026-07-09T00:00:00');
    expect(formatDateMedium(new Date('2026-12-14T00:00:00'), now)).toBe('14 Dec');
  });

  it('appends the year once it differs from `now` (F4)', () => {
    // The exact case named in the finding: a slow measured pace can
    // project a readyDate years out, and "Ready by 8 Jun" on a July 2026
    // screen would silently mean 2028 with nothing on screen to say so.
    const now = new Date('2026-07-09T00:00:00');
    expect(formatDateMedium(new Date('2028-06-08T00:00:00'), now)).toBe('8 Jun 2028');
  });
});

describe('formatExamMarginLine', () => {
  it('positive slack reads as margin', () => {
    expect(formatExamMarginLine(9)).toBe('9 days of margin');
  });

  it('negative slack reads as past the exam, magnitude only', () => {
    expect(formatExamMarginLine(-3)).toBe('3 days past the exam');
  });

  it('zero slack reads as margin (the boundary is inclusive on the calm side)', () => {
    expect(formatExamMarginLine(0)).toBe('0 days of margin');
  });
});

describe('formatRequiredPaceLine', () => {
  const now = new Date('2026-07-09T00:00:00');

  it('states the required pace and this week’s progress toward it, one decimal each', () => {
    const anchor = new Date('2026-11-01T00:00:00');
    expect(formatRequiredPaceLine(anchor, 6.5, 2, now)).toBe(
      'Ready by 1 Nov needs 6.5 h/week. This week: 2.0 of 6.5.',
    );
  });

  it('says the window is open instead of a rate once requiredPace is null', () => {
    const anchor = new Date('2026-11-01T00:00:00');
    expect(formatRequiredPaceLine(anchor, null, 2, now)).toBe('The exam window is open.');
  });

  it('appends the anchor’s year once it differs from `now` (F4)', () => {
    const anchor = new Date('2028-06-08T00:00:00');
    expect(formatRequiredPaceLine(anchor, 6.5, 2, now)).toBe(
      'Ready by 8 Jun 2028 needs 6.5 h/week. This week: 2.0 of 6.5.',
    );
  });

  it('says there is not enough time left instead of an absurd rate once requiredPace exceeds 168 h/week (F12)', () => {
    // 24 * 7 = 168, the ceiling on how many hours a week actually has.
    const anchor = new Date('2026-11-01T00:00:00');
    expect(formatRequiredPaceLine(anchor, 169, 2, now)).toBe(
      'Ready by 1 Nov needs more hours than remain before it.',
    );
  });

  it('168 h/week exactly still prints as a (barely) achievable rate, not the overflow copy', () => {
    const anchor = new Date('2026-11-01T00:00:00');
    expect(formatRequiredPaceLine(anchor, 168, 2, now)).toBe(
      'Ready by 1 Nov needs 168.0 h/week. This week: 2.0 of 168.0.',
    );
  });
});

describe('formatScheduleDays', () => {
  it('a Mon-Fri run collapses to a single range', () => {
    expect(formatScheduleDays([1, 2, 3, 4, 5])).toBe('Mon–Fri');
  });

  it('all seven days collapse to "Daily", not "Mon–Sun"', () => {
    expect(formatScheduleDays([1, 2, 3, 4, 5, 6, 7])).toBe('Daily');
  });

  it('a single day renders as just its name, no dash', () => {
    expect(formatScheduleDays([3])).toBe('Wed');
  });

  it('non-contiguous days list separately, comma-joined', () => {
    expect(formatScheduleDays([1, 3, 5])).toBe('Mon, Wed, Fri');
  });

  it('unsorted input still renders Monday-first', () => {
    expect(formatScheduleDays([5, 1, 3])).toBe('Mon, Wed, Fri');
  });

  it('a weekend range mixed with a lone weekday', () => {
    expect(formatScheduleDays([6, 7, 2])).toBe('Tue, Sat–Sun');
  });

  it('wrap-around is NOT collapsed into a circular range: Sat, Sun, Mon stays two parts', () => {
    // The week has a Monday start here, no circular ranges (see the
    // function's own doc comment) — a wrapped "Sat–Mon" would be a
    // clever reading of the data, not a clear one.
    expect(formatScheduleDays([6, 7, 1])).toBe('Mon, Sat–Sun');
  });

  it('duplicate day numbers in the input do not produce a duplicate part', () => {
    expect(formatScheduleDays([1, 1, 2])).toBe('Mon–Tue');
  });
});

describe('formatCountdown', () => {
  it('mm:ss while time remains', () => {
    expect(formatCountdown(24 * 60 + 59)).toBe('24:59');
  });

  it('pads single-digit seconds', () => {
    expect(formatCountdown(5 * 60 + 5)).toBe('5:05');
  });

  it('zero reads as 0:00, not an overrun', () => {
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('switches to a leading "+" and counts up once negative (overrun)', () => {
    expect(formatCountdown(-(3 * 60 + 12))).toBe('+3:12');
  });

  it('pads overrun seconds too', () => {
    expect(formatCountdown(-65)).toBe('+1:05');
  });
});
