import { describe, expect, it } from 'vitest';
import { eventsWithoutDepartures } from './calendarEvents';
import type { CalendarEvent } from '../native/calendar';
import type { Departure } from '../db/types';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    title: 'Klinik appointment',
    beginEpochMs: new Date('2026-07-09T14:30:00.000Z').getTime(),
    location: 'Klinikum Stuttgart',
    allDay: false,
    rrule: null,
    ...overrides,
  };
}

function makeDeparture(overrides: Partial<Departure> = {}): Departure {
  return {
    id: 'departure-1',
    templateId: null,
    name: 'Klinik',
    destination: 'Klinikum Stuttgart',
    appointmentAt: '2026-07-09T14:30:00.000Z',
    travelMinutes: 20,
    bufferMinutes: 10,
    steps: [],
    status: 'planned',
    startedAt: null,
    leftAt: null,
    arrivalResult: null,
    arrivalLateMinutes: null,
    createdAt: '2026-07-09T07:00:00.000Z',
    originalAppointmentAt: '2026-07-09T14:30:00.000Z',
    scheduledForDate: null,
    wasReplanned: false,
    arrivalSteps: [],
    arrivedAt: null,
    arrivalWifiSsid: null,
    ...overrides,
  };
}

describe('eventsWithoutDepartures', () => {
  it('hides an event with an exact-match departure', () => {
    const event = makeEvent();
    const departure = makeDeparture({ appointmentAt: new Date(event.beginEpochMs).toISOString() });
    expect(eventsWithoutDepartures([event], [departure])).toEqual([]);
  });

  it('hides an event with a departure exactly 5 minutes away (boundary, inclusive)', () => {
    const event = makeEvent();
    const shiftedMs = event.beginEpochMs + 5 * 60_000;
    const departure = makeDeparture({ appointmentAt: new Date(shiftedMs).toISOString() });
    expect(eventsWithoutDepartures([event], [departure])).toEqual([]);
  });

  it('keeps an event with a departure just outside the 5-minute window', () => {
    const event = makeEvent();
    const shiftedMs = event.beginEpochMs + 5 * 60_000 + 1;
    const departure = makeDeparture({ appointmentAt: new Date(shiftedMs).toISOString() });
    expect(eventsWithoutDepartures([event], [departure])).toEqual([event]);
  });

  it('dedupes regardless of departure status, including abandoned', () => {
    const event = makeEvent();
    const departure = makeDeparture({
      appointmentAt: new Date(event.beginEpochMs).toISOString(),
      status: 'abandoned',
    });
    expect(eventsWithoutDepartures([event], [departure])).toEqual([]);
  });

  it('keeps an event when there are no departures at all', () => {
    const event = makeEvent();
    expect(eventsWithoutDepartures([event], [])).toEqual([event]);
  });

  it('only hides the matching event out of several, leaving the rest', () => {
    const matched = makeEvent({ title: 'Matched', beginEpochMs: new Date('2026-07-09T14:30:00.000Z').getTime() });
    const unmatched = makeEvent({ title: 'Unmatched', beginEpochMs: new Date('2026-07-10T09:00:00.000Z').getTime() });
    const departure = makeDeparture({ appointmentAt: new Date(matched.beginEpochMs).toISOString() });
    expect(eventsWithoutDepartures([matched, unmatched], [departure])).toEqual([unmatched]);
  });

  it('excludes an all-day event even with no matching departure at all', () => {
    const allDay = makeEvent({ title: 'Birthday', allDay: true });
    expect(eventsWithoutDepartures([allDay], [])).toEqual([]);
  });
});
