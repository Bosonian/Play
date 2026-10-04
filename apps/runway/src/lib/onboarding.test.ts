import { describe, expect, it } from 'vitest';
import {
  buildFirstDeparture,
  isPruefungEnabled,
  looksFresh,
  resolveAppointment,
  shouldBackfillOnboardingDone,
  shouldShowOnboarding,
  type FreshnessFacts,
} from './onboarding';

const FRESH: FreshnessFacts = { departureCount: 0, taskCount: 0, hasExam: false, nonSeedTemplateCount: 0 };
const SET = { value: 'true' };

describe('shouldShowOnboarding', () => {
  it('shows on a fresh install with no flag', () => {
    expect(shouldShowOnboarding(null, FRESH)).toBe(true);
  });

  it('does not show when the flag is already set', () => {
    expect(shouldShowOnboarding(SET, FRESH)).toBe(false);
  });

  it('does not show when a departure exists', () => {
    expect(shouldShowOnboarding(null, { ...FRESH, departureCount: 1 })).toBe(false);
  });

  it('does not show when a task exists', () => {
    expect(shouldShowOnboarding(null, { ...FRESH, taskCount: 1 })).toBe(false);
  });

  it('does not show when an exam exists', () => {
    expect(shouldShowOnboarding(null, { ...FRESH, hasExam: true })).toBe(false);
  });

  it('does not show when a non-seed template exists', () => {
    expect(shouldShowOnboarding(null, { ...FRESH, nonSeedTemplateCount: 1 })).toBe(false);
  });

  it('does not show while the flag is still loading (undefined)', () => {
    expect(shouldShowOnboarding(undefined, FRESH)).toBe(false);
  });

  it('does not show while the facts are still loading', () => {
    expect(shouldShowOnboarding(null, undefined)).toBe(false);
  });

  it('treats the seed template alone as no data (count excludes it)', () => {
    // The caller passes nonSeedTemplateCount; a database holding only the
    // seed template yields 0 and so is still fresh.
    expect(looksFresh({ ...FRESH, nonSeedTemplateCount: 0 })).toBe(true);
    expect(shouldShowOnboarding(null, { ...FRESH, nonSeedTemplateCount: 0 })).toBe(true);
  });

  it('does not show for an install like the author\'s: templates, departures and an exam, flag never written', () => {
    expect(
      shouldShowOnboarding(null, { departureCount: 140, taskCount: 12, hasExam: true, nonSeedTemplateCount: 6 }),
    ).toBe(false);
  });
});

describe('shouldBackfillOnboardingDone', () => {
  it('backfills for an existing install with no flag', () => {
    expect(shouldBackfillOnboardingDone(null, { ...FRESH, hasExam: true })).toBe(true);
  });
  it('does not backfill a fresh install (it will be shown onboarding instead)', () => {
    expect(shouldBackfillOnboardingDone(null, FRESH)).toBe(false);
  });
  it('does not backfill when the flag exists', () => {
    expect(shouldBackfillOnboardingDone(SET, { ...FRESH, hasExam: true })).toBe(false);
  });
  it('does not backfill while loading', () => {
    expect(shouldBackfillOnboardingDone(undefined, { ...FRESH, hasExam: true })).toBe(false);
    expect(shouldBackfillOnboardingDone(null, undefined)).toBe(false);
  });
});

describe('isPruefungEnabled', () => {
  it('absent setting + existing exam reads as enabled (existing install keeps Prüfung)', () => {
    expect(isPruefungEnabled(null, true)).toBe(true);
  });
  it('absent setting + no exam reads as disabled (fresh install default)', () => {
    expect(isPruefungEnabled(null, false)).toBe(false);
  });
  it('explicit true enables, with or without an exam', () => {
    expect(isPruefungEnabled({ value: 'true' }, false)).toBe(true);
    expect(isPruefungEnabled({ value: 'true' }, true)).toBe(true);
  });
  it('explicit false hides even when an exam exists', () => {
    expect(isPruefungEnabled({ value: 'false' }, true)).toBe(false);
  });
  it('loading reads as disabled', () => {
    expect(isPruefungEnabled(undefined, true)).toBe(false);
    expect(isPruefungEnabled(null, undefined)).toBe(false);
  });
});

describe('resolveAppointment', () => {
  const now = new Date(2026, 9, 4, 14, 0, 0);
  it('uses today when the time is ahead', () => {
    const r = resolveAppointment('17:30', now)!;
    expect(r.isTomorrow).toBe(false);
    expect(r.at.getDate()).toBe(4);
    expect(r.at.getHours()).toBe(17);
    expect(r.at.getMinutes()).toBe(30);
  });
  it('rolls to tomorrow when the time has passed', () => {
    const r = resolveAppointment('09:00', now)!;
    expect(r.isTomorrow).toBe(true);
    expect(r.at.getDate()).toBe(5);
  });
  it('rolls to tomorrow when the time is within the next minute', () => {
    expect(resolveAppointment('14:00', now)!.isTomorrow).toBe(true);
  });
  it('rolls over a month end', () => {
    const r = resolveAppointment('08:00', new Date(2026, 9, 31, 20, 0, 0))!;
    expect(r.at.getMonth()).toBe(10);
    expect(r.at.getDate()).toBe(1);
  });
  it('rejects malformed input', () => {
    expect(resolveAppointment('', now)).toBeNull();
    expect(resolveAppointment('25:00', now)).toBeNull();
    expect(resolveAppointment('9:00', now)).toBeNull();
  });
});

describe('buildFirstDeparture', () => {
  let n = 0;
  const base = {
    name: '  Dentist ',
    appointmentAt: new Date(2026, 9, 4, 17, 30),
    travelMinutes: 20,
    steps: [
      { name: 'Get dressed', minutes: 10 },
      { name: '   ', minutes: 5 },
      { name: ' Keys ', minutes: 2 },
    ],
    now: new Date(2026, 9, 4, 14, 0),
    newId: () => `id-${++n}`,
  };
  it('trims, drops blank steps, and marks estimates manual', () => {
    const d = buildFirstDeparture(base);
    expect(d.name).toBe('Dentist');
    expect(d.steps.map((s) => s.name)).toEqual(['Get dressed', 'Keys']);
    expect(d.steps.every((s) => s.checkedAt === null && s.estimateSource === 'manual')).toBe(true);
    expect(d.status).toBe('planned');
    expect(d.templateId).toBeNull();
    expect(d.originalAppointmentAt).toBe(d.appointmentAt);
  });
  it('falls back to a name when blank', () => {
    expect(buildFirstDeparture({ ...base, name: '  ' }).name).toBe('First departure');
  });
});
