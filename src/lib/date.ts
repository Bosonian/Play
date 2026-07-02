// Dates for scheduling. The SRS "day" is anchored to Europe/Berlin (the user's
// timezone) so "due today" is stable offline and doesn't drift with the device
// clock or travel (design doc §4a). Cards store a date-only ISO string
// (YYYY-MM-DD); those compare correctly with plain string ordering.

import { addDays, format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TZ = 'Europe/Berlin';

export function todayISO(): string {
  return format(toZonedTime(new Date(), TZ), 'yyyy-MM-dd');
}

export function addDaysISO(iso: string, days: number): string {
  return format(addDays(parseISO(iso), days), 'yyyy-MM-dd');
}

// True when `dueOn` is today or earlier (i.e. the card is due). ISO date-only
// strings sort lexicographically, so a string compare is a date compare.
export function isDue(dueOn: string, today: string = todayISO()): boolean {
  return dueOn <= today;
}
