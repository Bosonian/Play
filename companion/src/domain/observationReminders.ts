export const OBSERVATION_REMINDER_PLAN_VERSION = 1 as const;
export const REMINDER_INTERVAL_PRESETS = [30, 60, 120, 240] as const;
export type ReminderIntervalMinutes = typeof REMINDER_INTERVAL_PRESETS[number];

export interface ObservationReminderPlanV1 {
  version: typeof OBSERVATION_REMINDER_PLAN_VERSION;
  revision: number;
  enabled: boolean;
  mode: 'interval' | 'custom';
  timeZone: string;
  firstTime: string;
  lastTime: string;
  intervalMinutes?: ReminderIntervalMinutes;
  customTimes?: string[];
}

export interface ObservationReminderOccurrence {
  id: string;
  revision: number;
  localDate: string;
  localTime: string;
  scheduledAt: string;
}

export interface ObservationReminderOpen {
  occurrenceId: string;
  studyId: string;
  revision: number;
  scheduledAt: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutes(time: string): number {
  const match = TIME.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

export function isIanaTimeZone(value: string): boolean {
  try {
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

export function validateObservationReminderPlan(plan: ObservationReminderPlanV1): string[] {
  const errors: string[] = [];
  if (plan.version !== 1) errors.push('Unsupported reminder plan version.');
  if (!Number.isInteger(plan.revision) || plan.revision < 1) errors.push('Reminder revision must be a positive integer.');
  if (!isIanaTimeZone(plan.timeZone)) errors.push('Choose a valid IANA time zone.');
  if (!TIME.test(plan.firstTime) || !TIME.test(plan.lastTime)) errors.push('Enter first and last times as HH:MM.');
  const first = minutes(plan.firstTime);
  const last = minutes(plan.lastTime);
  if (Number.isFinite(first) && Number.isFinite(last) && first >= last) {
    errors.push('The reminder window must end later on the same day.');
  }
  if (plan.mode === 'interval') {
    if (!REMINDER_INTERVAL_PRESETS.includes(plan.intervalMinutes as ReminderIntervalMinutes)) {
      errors.push('Choose a 30 minute, 1 hour, 2 hour, or 4 hour interval.');
    }
  } else {
    const times = plan.customTimes ?? [];
    if (times.length === 0) errors.push('Add at least one reminder time.');
    if (times.some((time) => !TIME.test(time))) errors.push('Enter custom times as HH:MM.');
    if (new Set(times).size !== times.length) errors.push('Custom reminder times must be unique.');
    if (Number.isFinite(first) && Number.isFinite(last)
      && times.some((time) => minutes(time) < first || minutes(time) > last)) {
      errors.push('Custom times must stay inside the same-day reminder window.');
    }
  }
  return errors;
}

export function reminderTimes(plan: ObservationReminderPlanV1): string[] {
  if (validateObservationReminderPlan(plan).length > 0 || !plan.enabled) return [];
  if (plan.mode === 'custom') return [...(plan.customTimes ?? [])].sort();
  const result: string[] = [];
  const first = minutes(plan.firstTime);
  const last = minutes(plan.lastTime);
  for (let value = first; value <= last; value += plan.intervalMinutes!) {
    result.push(`${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`);
  }
  return result;
}

// Bound the cache because time zones can come from imported study configuration.
const localFormatters = new Map<string, Intl.DateTimeFormat>();

function localParts(at: Date, timeZone: string) {
  let formatter = localFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    });
    if (localFormatters.size >= 8) localFormatters.delete(localFormatters.keys().next().value!);
    localFormatters.set(timeZone, formatter);
  }
  const entries = formatter.formatToParts(at);
  return Object.fromEntries(entries.map((entry) => [entry.type, entry.value]));
}

function localInstant(date: string, time: string, timeZone: string): Date | null {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = localParts(new Date(guess), timeZone);
    const represented = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute),
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute);
    guess += desired - represented;
  }
  const matches: Date[] = [];
  for (let deltaMinutes = -180; deltaMinutes <= 180; deltaMinutes += 15) {
    const candidate = new Date(guess + deltaMinutes * 60_000);
    const parts = localParts(candidate, timeZone);
    if (parts.year === String(year).padStart(4, '0')
      && parts.month === String(month).padStart(2, '0')
      && parts.day === String(day).padStart(2, '0')
      && parts.hour === String(hour).padStart(2, '0')
      && parts.minute === String(minute).padStart(2, '0')) {
      matches.push(candidate);
    }
  }
  return matches.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}

function addLocalDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function expandObservationReminderOccurrences(
  studyId: string,
  startedAt: string,
  plannedEndAt: string,
  plan: ObservationReminderPlanV1,
): ObservationReminderOccurrence[] {
  if (validateObservationReminderPlan(plan).length > 0 || !plan.enabled) return [];
  const start = new Date(startedAt);
  const end = new Date(plannedEndAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) return [];
  const startParts = localParts(start, plan.timeZone);
  const endParts = localParts(end, plan.timeZone);
  let date = `${startParts.year}-${startParts.month}-${startParts.day}`;
  const lastDate = `${endParts.year}-${endParts.month}-${endParts.day}`;
  const occurrences: ObservationReminderOccurrence[] = [];
  while (date <= lastDate) {
    for (const time of reminderTimes(plan)) {
      const instant = localInstant(date, time, plan.timeZone);
      if (!instant || instant < start || instant >= end) continue;
      occurrences.push({
        id: `${studyId}:r${plan.revision}:${date}T${time}`,
        revision: plan.revision,
        localDate: date,
        localTime: time,
        scheduledAt: instant.toISOString(),
      });
    }
    date = addLocalDay(date);
  }
  return occurrences;
}

export function validateObservationReminderOpen(
  pending: ObservationReminderOpen,
  study: {
    id: string;
    status: string;
    startedAt: string;
    plannedEndAt: string;
    reminderPlan?: ObservationReminderPlanV1;
  } | undefined,
  completedOccurrenceIds: ReadonlySet<string>,
  now = new Date().toISOString(),
): { valid: true; occurrence: ObservationReminderOccurrence } | { valid: false; reason: string } {
  if (!study || study.id !== pending.studyId || study.status !== 'active') {
    return { valid: false, reason: 'That reminder belongs to a study that is no longer active.' };
  }
  const current = Date.parse(now);
  const scheduled = Date.parse(pending.scheduledAt);
  const started = Date.parse(study.startedAt);
  const ended = Date.parse(study.plannedEndAt);
  if (![current, scheduled, started, ended].every(Number.isFinite)
    || current < started || current >= ended || scheduled > current) {
    return { valid: false, reason: 'That reminder is not current for the active study window.' };
  }
  const plan = study.reminderPlan;
  if (!plan?.enabled || plan.revision !== pending.revision) {
    return { valid: false, reason: 'That reminder was replaced by a newer reminder plan.' };
  }
  if (completedOccurrenceIds.has(pending.occurrenceId)) {
    return { valid: false, reason: 'That reminder check has already been completed.' };
  }
  // Validate only the opened occurrence; expanding a whole multiweek study here
  // would block notification navigation on the WebView thread.
  const mismatch = { valid: false as const, reason: 'That reminder no longer matches the active schedule.' };
  if (scheduled < started || scheduled >= ended || validateObservationReminderPlan(plan).length > 0) {
    return mismatch;
  }
  const parts = localParts(new Date(scheduled), plan.timeZone);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localTime = `${parts.hour}:${parts.minute}`;
  if (!reminderTimes(plan).includes(localTime)) return mismatch;
  const instant = localInstant(localDate, localTime, plan.timeZone);
  const id = `${study.id}:r${plan.revision}:${localDate}T${localTime}`;
  if (id !== pending.occurrenceId || instant?.toISOString() !== pending.scheduledAt) return mismatch;
  return { valid: true, occurrence: {
    id, revision: plan.revision, localDate, localTime, scheduledAt: pending.scheduledAt,
  } };
}
