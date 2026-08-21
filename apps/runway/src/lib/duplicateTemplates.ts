import type { Departure, Template } from '../db/types';

// Field report #12's residue: the twin-minting bug in DepartureSetup's
// save-with-repeat path (since fixed — see that screen's own comment on the
// reuse path) already produced twin templates before the fix landed, and
// nothing has ever cleaned those up. This file is read-only detection —
// pure, no Dexie import, so it's testable without a database — for
// mergeTemplates.ts's write side and Home/Settings' own "a duplicate exists"
// checks to share one definition of "these two templates are the same
// routine saved twice."

/**
 * One template in a duplicate group, with how much learning history it
 * carries — the number of COMPLETED (`status` 'left' or 'done') departures
 * that point at it. This is deliberately the same status pair
 * `isEligibleDepartureRun` (learning.ts) and Home's own `calibrationDepartures`
 * query use for "counts as real history" — not a stricter eligibility check
 * (no isBatchedRun exclusion, no wasReplanned split): this count only ever
 * drives a coarse ranking ("which twin has more history") for the merge UI's
 * default "keep" choice, never a learning calculation itself, so it doesn't
 * need learning.ts's full precision.
 */
export interface DuplicateTemplateCandidate {
  template: Template;
  completedDepartureCount: number;
}

/**
 * A set of 2+ templates that are almost certainly the same routine saved
 * twice. `key` is the normalised grouping key (see `normaliseKey` below) —
 * exposed only as a stable identifier for callers (a React list key, a test
 * assertion), never shown to the user, who sees the templates' own real
 * name/destination strings instead. `candidates` is sorted richest-history
 * first, so `candidates[0]` is the group's suggested "keep" — the template
 * with the most completed departures, i.e. the most learning history to
 * preserve by keeping it as the surviving row.
 */
export interface DuplicateTemplateGroup {
  key: string;
  candidates: DuplicateTemplateCandidate[];
}

/**
 * Collapses whitespace and case so "Punctual to Work" / "punctual  to work"
 * / " Punctual to work " all normalise to the same string — voice dictation
 * (CLAUDE.md: Deepak's primary text input) routinely produces exactly this
 * class of near-duplicate spelling, and a byte-exact match would miss twins
 * that differ only in how a phrase happened to get typed or dictated twice.
 */
function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The NUL character (\u0000, written as an escape so the source file
 * itself stays plain ASCII rather than embedding a raw control byte) joins
 * name and destination rather than plain concatenation or a printable
 * separator like a space — without one, name="a b" + destination="c" and
 * name="a" + destination="b c" would both collapse to "a b c" and falsely
 * group two templates that go to different places. NUL can never appear in
 * a real name/destination string (it is not typeable, and Dexie/IndexedDB
 * text fields do not carry it), so it is a genuinely collision-free join.
 */
function normaliseKey(name: string, destination: string): string {
  return `${collapse(name)}\u0000${collapse(destination)}`;
}

/**
 * Groups templates by normalised name+destination and returns every group
 * of 2 or more — each one a duplicate set per this file's header comment.
 * A template with no match (the overwhelmingly common case) simply isn't
 * part of any returned group. Pure function of `templates`/`departures`, no
 * Dexie import — mergeTemplates.ts's Dexie-touching write side is a
 * separate module built on top of this one's read-only answer.
 */
export function findDuplicateTemplates(templates: Template[], departures: Departure[]): DuplicateTemplateGroup[] {
  const completedCounts = new Map<string, number>();
  for (const departure of departures) {
    if (departure.templateId == null) continue;
    if (departure.status !== 'left' && departure.status !== 'done') continue;
    completedCounts.set(departure.templateId, (completedCounts.get(departure.templateId) ?? 0) + 1);
  }

  const byKey = new Map<string, Template[]>();
  for (const template of templates) {
    const key = normaliseKey(template.name, template.destination);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(template);
    else byKey.set(key, [template]);
  }

  const groups: DuplicateTemplateGroup[] = [];
  for (const [key, bucket] of byKey) {
    if (bucket.length < 2) continue;
    const candidates = bucket
      .map((template) => ({ template, completedDepartureCount: completedCounts.get(template.id) ?? 0 }))
      .sort((a, b) => b.completedDepartureCount - a.completedDepartureCount);
    groups.push({ key, candidates });
  }
  return groups;
}
