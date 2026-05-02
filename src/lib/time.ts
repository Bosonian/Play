import { format, startOfISOWeek } from 'date-fns';
import type { ISODate, ISODateTime } from '../db/types';

// Today as an ISO date string in LOCAL time (e.g. "2026-05-02").
// Local — not UTC — so "today" rolls over at the user's local midnight.
export function todayISO(): ISODate {
  return format(new Date(), 'yyyy-MM-dd');
}

// True if the given timestamp falls within the current ISO week (Monday-start
// per CLAUDE.md). Null counts as "not this week" — used to mean unseen.
export function isThisWeek(isoDateTime: ISODateTime | null): boolean {
  if (!isoDateTime) return false;
  return new Date(isoDateTime) >= startOfISOWeek(new Date());
}
