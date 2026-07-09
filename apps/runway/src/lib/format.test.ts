import { describe, expect, it } from 'vitest';
import { formatAppointmentLine, formatSlackLine } from './format';

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
