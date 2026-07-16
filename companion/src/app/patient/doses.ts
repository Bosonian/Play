// Pure dose-scheduling / display helpers — no Dexie, no React, no browser DOM
// APIs beyond Date/Intl (both available in plain node). Same discipline as
// log.ts (see that file's header). Deliberately a SEPARATE module rather than
// an extension of log.ts, and log.ts imports doseLabel from here (not the
// other way round) — keeps the dependency graph one-directional, no cycle.
import type { DrugId } from '../../domain/drugs';
import { DRUG_CATALOG } from '../../domain/drugs';
import type { RegimenItem } from '../../domain/regimen';
import type { DoseEvent, PatientEvent, ISODateTime } from '../../domain/types';
import { safeUuid } from '../lib/uuid';
import { slotForTime, SLOT_DEFS, type SlotId } from '../../domain/grid';

export interface DoseSlot {
  itemId: string; // provenance (RegimenItem.id) — NOT part of the match key
  drug: DrugId;
  doseMg: number;
  time: string; // scheduled local "HH:MM"
}

// Expands a regimen into one slot per (item, time) — the checklist the
// patient sees today. Sorted by time ascending, tie-broken by catalog generic
// name: the same ordering as sortRegimenItems (regimen.ts), just applied at
// the per-slot rather than per-item granularity so two items sharing a clock
// time still order predictably.
export function expandSchedule(items: RegimenItem[]): DoseSlot[] {
  const slots: DoseSlot[] = [];
  for (const item of items) {
    for (const dt of item.times) {
      slots.push({ itemId: item.id, drug: item.drug, doseMg: dt.doseMg, time: dt.time });
    }
  }
  return slots.sort((a, b) => {
    if (a.time !== b.time) return a.time.localeCompare(b.time);
    return DRUG_CATALOG[a.drug].generic.localeCompare(DRUG_CATALOG[b.drug].generic);
  });
}

export interface SlotStatus {
  slot: DoseSlot;
  takenAt: ISODateTime | null; // matched event's ACTUAL at; null = pending
  eventId: string | null; // matched event id; null=pending. Lets the UI open the matched event and exclude consumed events from Recent activity.
}

// Pure display-side matching (SPEC RISK #1 — the crux of this increment).
// The stored record never says "taken" or "pending"; that status is always
// recomputed here from the raw events, so there is nothing to keep in sync
// and nothing that can drift into a lie about what actually happened.
//
// Matching rule: candidates are kind==='dose' events with a defined
// scheduledTime, sorted by `at` ascending (earliest first). Slots are walked
// in schedule order; each slot ticks on the FIRST unconsumed candidate whose
// drug and scheduledTime exactly equal the slot's — each candidate event can
// only tick one slot. doseMg is deliberately NOT part of the match key: if
// the doctor edits a slot's strength midday after the patient already logged
// it, a dose-inclusive key would suddenly show the slot as pending again and
// invite a double dose. Extra/rescue doses (no scheduledTime) never tick
// anything, and motor/meal events are ignored entirely.
//
// Accepted failure modes (deliberate, not bugs):
//  - The patient can tap the wrong pending slot. The tick then reflects a
//    mis-stated intent, but `at` is still the true moment the dose was
//    taken — the raw data is never corrupted, only the display-side label.
//  - Every slot for today is tappable all day, including ones still in the
//    future — there is no time-of-day gating on the slot buttons themselves.
//  - A degenerate regimen with two items at the same drug+time (unusual, but
//    not rejected by validateRegimenItem) only ever ticks the first slot from
//    one logged event; greedy, one-event-per-slot consumption prevents a
//    single tap from double-ticking both.
//  - A dose logged just after local midnight belongs to the new day's
//    slot list (today's window is todayRangeISO, applied by the caller).
export function markTakenSlots(slots: DoseSlot[], todaysEvents: PatientEvent[]): SlotStatus[] {
  const candidates = todaysEvents
    .filter((ev): ev is DoseEvent => ev.kind === 'dose' && ev.scheduledTime !== undefined)
    .sort((a, b) => a.at.localeCompare(b.at));
  const consumed = new Set<number>(); // indices into `candidates`

  return slots.map((slot) => {
    for (let i = 0; i < candidates.length; i++) {
      if (consumed.has(i)) continue;
      const ev = candidates[i];
      if (ev.drug === slot.drug && ev.scheduledTime === slot.time) {
        consumed.add(i);
        return { slot, takenAt: ev.at, eventId: ev.id };
      }
    }
    return { slot, takenAt: null, eventId: null };
  });
}

// Groups a slot checklist by day-part (SPEC §4). Reuses slotForTime's
// windows so a dose's day-part grouping and its BMP grid slot are always the
// same rule — no second definition of "what counts as morning" to drift out
// of sync with grid.ts. Day-parts with no slots today are OMITTED (not
// returned as empty groups) so Home never renders a heading with nothing
// under it.
export interface DaypartGroup {
  slotId: SlotId;
  label: string;
  statuses: SlotStatus[];
}

// 0 for the "late" half of the night window (21:00-23:59), 1 for the "early"
// half (00:00-03:59) — used only to rank nachts entries late-before-early.
function lateNightRank(time: string): 0 | 1 {
  return time >= '21:00' ? 0 : 1;
}

export function groupSlotsByDaypart(statuses: SlotStatus[]): DaypartGroup[] {
  const bySlot = new Map<SlotId, SlotStatus[]>();
  for (const status of statuses) {
    const slotId = slotForTime(status.slot.time);
    const bucket = bySlot.get(slotId);
    if (bucket) bucket.push(status);
    else bySlot.set(slotId, [status]);
  }

  const groups: DaypartGroup[] = [];
  for (const def of SLOT_DEFS) {
    const bucket = bySlot.get(def.id);
    if (!bucket || bucket.length === 0) continue;
    // Every day-part preserves input order (already time-sorted by
    // expandSchedule) EXCEPT 'nachts', which wraps midnight: its members can
    // be a mix of "late" (21:00-23:59) and "early" (00:00-03:59) clock times.
    // A plain string/time sort would put "00:30" before "22:00" even though
    // 22:00 comes first in the night — so rank "late" times ahead of "early"
    // ones and let Array.prototype.sort's stability (guaranteed by the
    // ECMAScript spec) preserve each half's original relative order.
    const ordered =
      def.id === 'nachts'
        ? [...bucket].sort((a, b) => lateNightRank(a.slot.time) - lateNightRank(b.slot.time))
        : bucket;
    groups.push({ slotId: def.id, label: def.label, statuses: ordered });
  }
  return groups;
}

// Mirrors buildMotorEvent/buildMealEvent in log.ts: source 'self', id
// defaulted. scheduledTime is only set when the caller passes one (the
// "Log another dose" extra-dose path omits it entirely).
export function buildDoseEvent(
  patientCode: string,
  drug: DrugId,
  doseMg: number,
  at: ISODateTime,
  scheduledTime?: string,
  id: string = safeUuid(),
): DoseEvent {
  return {
    id,
    patient: patientCode,
    at,
    kind: 'dose',
    drug,
    doseMg,
    ...(scheduledTime !== undefined ? { scheduledTime } : {}),
    source: 'self',
  };
}

// Distinct (drug, doseMg) pairs for the extra-dose picker, in schedule order
// (by each pair's first appearance across expandSchedule's ordering),
// deduped. A drug prescribed at two different strengths (an uneven regimen)
// keeps both strengths as separate picker rows — they're different doses.
export function extraDoseChoices(items: RegimenItem[]): Array<{ drug: DrugId; doseMg: number }> {
  const slots = expandSchedule(items);
  const seen = new Set<string>();
  const choices: Array<{ drug: DrugId; doseMg: number }> = [];
  for (const slot of slots) {
    const key = `${slot.drug}|${slot.doseMg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({ drug: slot.drug, doseMg: slot.doseMg });
  }
  return choices;
}

// "Levodopa 100 mg" — shared by slot rows, the extra-dose picker, and
// eventLabel's dose branch, so the three can never drift out of sync.
export function doseLabel(drug: DrugId, doseMg: number): string {
  return `${DRUG_CATALOG[drug].generic} ${doseMg} mg`;
}

// The taken-row verb: a transdermal patch is "Applied", every other
// formulation is "Taken". Pure lookup on the catalog, not a special case
// hardcoded to rotigotine's id, so any future patch formulation picks this up
// automatically.
export function takenVerb(drug: DrugId): 'Taken' | 'Applied' {
  return DRUG_CATALOG[drug].formulation === 'transdermal-patch' ? 'Applied' : 'Taken';
}
