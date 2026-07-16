// Pure patient-logging helpers — no Dexie, no React, no browser DOM APIs
// beyond Date/Intl (both available in plain node). This lets log.test.ts run
// in vitest's default 'node' environment with no fake-indexeddb shim: the
// actual DB writes happen one layer up, in usePatient.ts / PatientRoot.tsx.
import type { MealEvent, MotorEvent, PatientEvent, ISODateTime } from '../../domain/types';
import { mapPatientTap, type PrimaryTap, type DyskinesiaRefinement } from '../../domain/motor';
import { safeUuid } from '../lib/uuid';
import { doseLabel } from './doses';

// Builds a motor event from a primary tap. Deliberately has NO refinement
// parameter: the tap logs immediately (RESEARCH §1 — one tap, timestamp
// auto-captured), and any troublesome/non-troublesome refinement is a
// follow-up mutation via refineDyskinesia below, applied to the same event id.
export function buildMotorEvent(
  patientCode: string,
  primary: PrimaryTap,
  at: ISODateTime,
  id: string = safeUuid(),
): MotorEvent {
  return {
    id,
    patient: patientCode,
    at,
    kind: 'motor',
    state: mapPatientTap(primary),
    source: 'self',
  };
}

// Refines an already-logged "on-dyskinesia" event to troublesome or
// non-troublesome. Returns a NEW object (never mutates the input) so React
// state holding the old event (e.g. PatientRoot's lastAction) stays a stable
// reference until explicitly replaced.
//
// Guard: if the event's current state isn't one of the three
// on-dyskinesia-* values, return it unchanged. This shouldn't happen given
// how PatientRoot wires State.tsx (refine is only reachable right after an
// on-dyskinesia tap), but it's cheap defensive coding against a future
// wiring mistake silently corrupting an unrelated event's state.
export function refineDyskinesia(event: MotorEvent, refinement: DyskinesiaRefinement): MotorEvent {
  if (
    event.state !== 'on-dyskinesia-unspecified' &&
    event.state !== 'on-dyskinesia-troublesome' &&
    event.state !== 'on-dyskinesia-nontroublesome'
  ) {
    return event;
  }
  return {
    ...event,
    state: mapPatientTap('on-dyskinesia', refinement),
  };
}

export function buildMealEvent(
  patientCode: string,
  protein: 'low' | 'high',
  at: ISODateTime,
  id: string = safeUuid(),
): MealEvent {
  return {
    id,
    patient: patientCode,
    at,
    kind: 'meal',
    protein,
    source: 'self',
  };
}

// Shifts an event's `at` by deltaMinutes (±5 from the Event Detail stepper).
// Clamped so `at` can never exceed `nowISO` — a symptom or meal cannot be
// logged in the future. Backward shifts are NOT clamped and may cross local
// midnight freely.
//
// Consequence (deliberate, per SPEC): an event stepped back past local
// midnight leaves the Today timeline (todayRangeISO no longer covers it).
// It is still stored and still reachable — the always-visible date line in
// EventDetail is what keeps that legible instead of the event just
// "disappearing" from the user's perspective.
export function shiftEventTime<E extends { at: ISODateTime }>(
  event: E,
  deltaMinutes: number,
  nowISO: ISODateTime,
): E {
  const shiftedMs = new Date(event.at).getTime() + deltaMinutes * 60_000;
  const nowMs = new Date(nowISO).getTime();
  const clampedMs = Math.min(shiftedMs, nowMs);
  return { ...event, at: new Date(clampedMs).toISOString() };
}

// LOCAL midnight of `now`'s day through LOCAL 23:59:59.999, both converted to
// UTC ISO strings for the getEventsInRange query. Building this from local
// wall-clock time (not UTC-truncated) is what keeps "today" meaning the
// user's today rather than UTC's — otherwise evening events for anyone west
// of UTC would land on "tomorrow" and anyone east would lose late-night
// events to "yesterday".
export function todayRangeISO(now: Date): { startISO: ISODateTime; endISO: ISODateTime } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

// Local time, 24h, zero-padded — "08:05", "14:32". Manual getHours/getMinutes
// rather than toLocaleTimeString: locale-dependent formatting (AM/PM, comma
// placement, etc.) would make this untestable across environments.
export function formatTimeHM(iso: ISODateTime): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// A locally-generated placeholder patient code — NOT a doctor-assigned code.
// Pairing (a later sync increment) replaces or maps this onto a real
// doctor-assigned code. Never derived from anything identifying (name, etc).
export function generateLocalCode(): string {
  return `local-${safeUuid().slice(0, 8)}`;
}

// The exact display label for an event, shared by Home's timeline and
// EventDetail's heading so the two screens can never drift out of sync.
export function eventLabel(ev: PatientEvent): string {
  if (ev.kind === 'motor') {
    switch (ev.state) {
      case 'on':
        return 'ON';
      case 'off':
        return 'OFF';
      case 'on-dyskinesia-unspecified':
        return 'ON with dyskinesia';
      case 'on-dyskinesia-troublesome':
        return 'ON with dyskinesia · troublesome';
      case 'on-dyskinesia-nontroublesome':
        return 'ON with dyskinesia · not troublesome';
      case 'asleep':
        // Unreachable from the 3-tap patient flow today (see motor.ts) —
        // included so this switch stays exhaustive as the domain type grows.
        return 'Asleep';
      default: {
        const _exhaustive: never = ev.state;
        return _exhaustive;
      }
    }
  }
  if (ev.kind === 'meal') {
    if (ev.protein === 'high') return 'Meal · high protein';
    if (ev.protein === 'low') return 'Meal · low protein';
    // 'unknown' is in the MealEvent type (SPEC edge case #6) but the patient
    // UI never produces it — only reachable via some future import/sync
    // path. Defensive label, not in the spec's table.
    return 'Meal';
  }
  // ev.kind === 'dose' — "Levodopa 100 mg" etc. Shared with the dose slot
  // rows and the extra-dose picker via doseLabel (doses.ts), so the timeline,
  // Event Detail, and Today's-doses section never show three different
  // strings for the same event.
  return doseLabel(ev.drug, ev.doseMg);
}
