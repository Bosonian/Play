import { describe, expect, it } from 'vitest';
import { sprintDoneMessage, sprintStartMessage, taskDoneMessage, taskStartMessage } from './witness';

describe('sprintStartMessage', () => {
  it('names the topic, the box, and the report-back time', () => {
    expect(sprintStartMessage('Neuroanatomy', 50, new Date('2026-07-13T20:15:00'))).toBe(
      "Starting: 50 min on Neuroanatomy. I'll report back at 20:15.",
    );
  });

  it('formats a single-digit hour/minute with the same HH:mm padding as formatTime', () => {
    expect(sprintStartMessage('Pharmacology', 25, new Date('2026-07-13T09:05:00'))).toBe(
      "Starting: 25 min on Pharmacology. I'll report back at 09:05.",
    );
  });
});

describe('sprintDoneMessage', () => {
  it('names the topic and the actual minutes worked', () => {
    expect(sprintDoneMessage('Neuroanatomy', 48)).toBe('Done: 48 min on Neuroanatomy.');
  });
});

describe('taskStartMessage', () => {
  it('with a deadline: reports by the deadline time, no minute estimate', () => {
    expect(taskStartMessage('Befunden EEG', 5, new Date('2026-07-13T16:00:00'), 75)).toBe(
      "Starting: Befunden EEG, 5 units. I'll report by 16:00.",
    );
  });

  it('without a deadline: falls back to the planned total minutes', () => {
    expect(taskStartMessage('Befunden EEG', 5, null, 75)).toBe('Starting: Befunden EEG, 5 units, about 75 min.');
  });

  it('singular unit count reads as "unit", not "units", with a deadline', () => {
    expect(taskStartMessage('Discharge letter', 1, new Date('2026-07-13T12:00:00'), 15)).toBe(
      "Starting: Discharge letter, 1 unit. I'll report by 12:00.",
    );
  });

  it('singular unit count reads as "unit" without a deadline too', () => {
    expect(taskStartMessage('Discharge letter', 1, null, 15)).toBe('Starting: Discharge letter, 1 unit, about 15 min.');
  });
});

describe('taskDoneMessage', () => {
  it('mirrors the done summary\'s "N units · M min." phrasing', () => {
    expect(taskDoneMessage('Befunden EEG', 5, 82)).toBe('Done: Befunden EEG — 5 units · 82 min.');
  });

  it('singular unit count reads as "unit", not "units"', () => {
    expect(taskDoneMessage('Discharge letter', 1, 12)).toBe('Done: Discharge letter — 1 unit · 12 min.');
  });
});
