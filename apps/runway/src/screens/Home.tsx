import { useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Departure, Template } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { TextAction } from '../ui/TextAction';
import {
  formatAppointmentLine,
  formatDateDisplay,
  formatDateTimeShort,
  formatScheduleDays,
  formatSlackLine,
  formatTime,
} from '../lib/format';
import { taskProjection } from '../lib/taskProjection';
import {
  cancelDepartureAlarms,
  getExactAlarmStatus,
  getNotificationPermissionStatus,
  openExactAlarmSettings,
} from '../native/notifications';
import { getUpcomingCalendarEvents, requestCalendarAccess } from '../native/calendar';
import type { CalendarEvent } from '../native/calendar';
import { eventsWithoutDepartures } from '../lib/calendarEvents';
import { parseWeeklyRrule } from '../lib/rrule';
import { CALENDAR_ENABLED_SETTING } from '../lib/calendarSettings';
import { readCaptureConfig } from '../lib/captureSettings';
import { captureDeparture } from '../lib/geminiApi';
import { computeBufferSuggestions, computeSuggestions } from '../lib/learning';
import type { BufferSuggestion, Suggestion } from '../lib/learning';
import { applyAutoLearn } from '../lib/autoLearn';
import { materializeScheduledDepartures, replaceUntouchedFutureAutoRows } from '../lib/materialize';
import { strandedArrivalLine, strandedInArrival } from '../lib/strandedArrival';
import { useNow } from '../hooks/useNow';
import { refreshWidgets } from '../native/widgets';
import { refreshDayGauge } from '../lib/dayGaugeRefresh';

/** Cap on "From your calendar" cards shown at once (E1; CLAUDE.md's
 * "defaults lean toward less, not more") — same shape as
 * MAX_VISIBLE_SUGGESTIONS/MAX_VISIBLE_UPCOMING below, just a smaller
 * number: this section is a discovery prompt, not a primary list, so it
 * earns even less room. */
const MAX_VISIBLE_CALENDAR_EVENTS = 3;

/** How far ahead "From your calendar" looks (E1 brief §A). Also the window
 * getUpcomingCalendarEvents defaults to, but passed explicitly here rather
 * than relying on that default — this is the one call site that actually
 * cares what the number is (it's in this section's own copy/behaviour, not
 * an implementation detail of the wrapper). */
const CALENDAR_LOOKAHEAD_HOURS = 48;
// M4's cutoff for "stale" - a planned/running departure whose appointment is
// more than this far in the past moves out of Upcoming and into its own
// dimmed section, so a missed morning appointment doesn't sit forever at the
// top of the list you check every time you're about to leave. Widgets
// increment: moved to its own lib file so the departure widget's
// source-selection logic (src/lib/widgetSnapshot.ts) can share the exact
// same number rather than redeclaring it.
import { PAST_DEPARTURE_THRESHOLD_MS } from '../lib/departureThreshold';

/** Same confirm copy as the Runway screen's "Abandon this departure" (M1/M2)
 * - removing a departure from Home and abandoning it mid-run are the same
 * operation (status -> 'abandoned', alarms cancelled), so they read as the
 * same sentence regardless of which screen it's triggered from. */
const REMOVE_CONFIRM = 'Remove this departure? Its alarms are cancelled.';

interface HomeProps {
  onNavigate: (screen: Screen) => void;
}

/** Cap on suggestions shown at once (increment-5 spec §4: "defaults lean
 * toward less, not more"). Any beyond the cap simply wait for a future
 * visit - nothing is lost, they're just not all dumped on screen together. */
const MAX_VISIBLE_SUGGESTIONS = 2;

/** Cap on Upcoming cards shown at once (recurring-departures increment;
 * CLAUDE.md's "defaults lean toward less, not more"). A recurring template
 * used to materialize up to HORIZON_DAYS (7) near-identical "Klinik 08:00"
 * cards into this list at once — field report #9 solved that upstream by
 * collapsing every auto-created occurrence of one template down to its
 * soonest card (see `collapsedUpcoming` below), so this cap is no longer
 * doing that job. It stays on as a backstop for the case collapsing
 * doesn't cover: many *distinct* templates/manual departures genuinely due
 * around the same time, which is still a real list worth trimming at a
 * glance rather than a duplicate-card artifact to eliminate. */
const MAX_VISIBLE_UPCOMING = 5;

/** Cap on Tasks cards shown at once (tasks increment; CLAUDE.md's "defaults
 * lean toward less, not more") — same "+N more" pattern as Upcoming above,
 * just a smaller number: unlike a week of scheduled departures, a resident
 * realistically has a small handful of task blocks in flight at once. */
const MAX_VISIBLE_TASKS = 3;

/** "Not now" dismissals, scoped to templateId+stepName. A module-level Set
 * (not component state) so a dismissal survives navigating away from Home
 * and back - it only resets on a full app reload, which is what "for this
 * session" means here. Suggestions never disappear permanently this way:
 * once the underlying data changes enough that computeSuggestions would
 * stop proposing it anyway, or after a reload, it's eligible to resurface. */
const dismissedSuggestions = new Set<string>();

function suggestionKey(suggestion: Suggestion): string {
  return `${suggestion.templateId}::${suggestion.stepName}`;
}

/** Same dismissal Set/pattern as step-time suggestions above, just a
 * distinct key shape ("buffer::" prefix) so a buffer dismissal for a
 * template can never collide with a step-time dismissal for the same
 * template. */
function bufferSuggestionKey(suggestion: BufferSuggestion): string {
  return `buffer::${suggestion.templateId}`;
}

/** Key into the `settings` table (db/db.ts v2) for the first-run card's
 * dismissal — see the "Done — don't show this again" handler below. */
const FIRST_RUN_DISMISSED_KEY = 'firstRunDismissed';

export function Home({ onNavigate }: HomeProps) {
  const templates = useLiveQuery(() => db.templates.toArray(), []);

  // Whether an exam already exists, for the Prüfung link's routing below.
  // `undefined` while this first read is still in flight is treated the
  // same as "no exam yet" (routes to examSetup) rather than gated behind
  // an explicit loading check — worst case on that race is a tap landing
  // on examSetup for an exam that does exist, and ExamSetup's own
  // already-exists guard (see its file comment) catches that and edits the
  // real exam instead of creating a duplicate, so nothing here needs to be
  // more careful than that.
  const exam = useLiveQuery(() => db.exams.toCollection().first(), []);

  // db.settings.get() resolves to undefined for a missing row — the same
  // value useLiveQuery yields while the query is still loading. Left as-is,
  // "fresh install, row never written" was indistinguishable from
  // "loading" and the card never showed at all. The ?? null sentinel
  // splits the two: undefined = still loading (card hidden, no flash),
  // null = loaded and never dismissed (card shows).
  const firstRunSetting = useLiveQuery(
    async () => (await db.settings.get(FIRST_RUN_DISMISSED_KEY)) ?? null,
    [],
  );
  const showFirstRunCard = Capacitor.isNativePlatform() && firstRunSetting === null;

  async function dismissFirstRunCard() {
    await db.settings.put({ key: FIRST_RUN_DISMISSED_KEY, value: 'true' });
  }

  // Checked on mount, native only, and re-checked on `visibilitychange`.
  // "Dismissable-per-session" (increment-4 §6) means exactly that — plain
  // component state, not persisted to Dexie or localStorage, so both
  // banners are back next time the app is reopened if the underlying
  // setting is still off. The visibilitychange re-check matters because
  // Android resumes the *same* activity when you back out of Settings —
  // there's no remount for a mount-only effect to ride along with, so
  // without this a banner you just fixed would keep showing until the next
  // full app relaunch (m3).
  const [exactAlarmsOff, setExactAlarmsOff] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [notificationsDenied, setNotificationsDenied] = useState(false);
  const [notificationBannerDismissed, setNotificationBannerDismissed] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    function refreshPermissionBanners() {
      void getExactAlarmStatus().then((status) => setExactAlarmsOff(status !== 'granted'));
      void getNotificationPermissionStatus().then((status) => setNotificationsDenied(status !== 'granted'));
    }

    refreshPermissionBanners();
    function handleVisibilityChange() {
      if (!document.hidden) refreshPermissionBanners();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Calendar increment (E1). Three-state settings row, same undefined/null
  // split the first-run card's own settings read uses above: `undefined`
  // while the row is still loading (section renders nothing that tick, no
  // flash), `null` (the row has never been written) means "never asked —
  // show the lazy-enable prompt", and a real 'true'/'false' string means
  // permission was granted or denied/turned-off respectively. Read via
  // useLiveQuery (not local state) so a toggle flipped on Settings while
  // Home is in the background is picked up the moment Home re-renders, no
  // separate sync needed.
  const calendarEnabledSetting = useLiveQuery(
    async () => (await db.settings.get(CALENDAR_ENABLED_SETTING)) ?? null,
    [],
  );
  const calendarNeverAsked = calendarEnabledSetting === null;
  const calendarEnabled = calendarEnabledSetting?.value === 'true';

  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[] | null>(null);

  // Loads events on mount + visibilitychange, same "calendar changes outside
  // the app" reasoning as the permission-banner effect just above — but only
  // once reading is actually enabled; there's nothing to load while it's
  // unset or declined. Deliberately does NOT call requestCalendarAccess()
  // here — see calendar.ts's own comment on why this passive refresh must
  // never itself trigger the OS permission dialog.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !calendarEnabled) return;

    function loadEvents() {
      void getUpcomingCalendarEvents(CALENDAR_LOOKAHEAD_HOURS).then(setCalendarEvents);
    }

    loadEvents();
    function handleVisibilityChange() {
      if (!document.hidden) loadEvents();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [calendarEnabled]);

  // Tapped from the section's lazy-enable TextAction. Denied is not an
  // error to retry — per this increment's own no-nagging rule, a 'false'
  // settings row after this means the section renders nothing further
  // *for the rest of this session*; app CLAUDE.md's "no permission ambush"
  // rule is exactly why this only ever fires from an explicit tap, never
  // automatically. Re-enabling after a decline is possible again, but only
  // from Settings' own "Calendar" toggle (Settings.tsx) — a deliberate,
  // separate re-ask, not a retry loop this component runs on its own.
  async function enableCalendar() {
    const granted = await requestCalendarAccess();
    await db.settings.put({ key: CALENDAR_ENABLED_SETTING, value: granted ? 'true' : 'false' });
  }

  // eventsWithoutDepartures (src/lib/calendarEvents.ts) needs every
  // departure regardless of status, including 'abandoned' — see its own
  // comment for why an abandoned departure still counts as "already
  // decided", not an invitation to re-surface the same appointment. This is
  // a genuinely separate query from `upcoming`/`calibrationDepartures`
  // below, each of which is deliberately scoped to its own status subset.
  const allDepartures = useLiveQuery(() => db.departures.toArray(), []);

  const visibleCalendarEvents = useMemo(() => {
    if (!calendarEvents || !allDepartures) return [];
    return eventsWithoutDepartures(calendarEvents, allDepartures).slice(0, MAX_VISIBLE_CALENDAR_EVENTS);
  }, [calendarEvents, allDepartures]);

  // planned/running departures, soonest appointment first — that ordering
  // is what makes "Upcoming" useful at a glance rather than a junk drawer.
  // Partitioned below (M4) into "Upcoming" proper and a separate, dimmed
  // "Past departure time" section, rather than filtered here at the query
  // level, so both sections share one live query and stay consistent with
  // each other as departures move between them.
  const upcoming = useLiveQuery(
    () =>
      db.departures
        .where('status')
        .anyOf(['planned', 'running'])
        .sortBy('appointmentAt'),
    [],
  );

  // Once a minute is plenty for a threshold this coarse (60 min) — a
  // per-second useNow() here would re-render Home every tick for no
  // visible benefit, unlike the Runway screen's live projection.
  const now = useNow(60_000);
  const upcomingDepartures = upcoming?.filter(
    (departure) => new Date(departure.appointmentAt).getTime() >= now.getTime() - PAST_DEPARTURE_THRESHOLD_MS,
  );
  const pastDepartures = upcoming?.filter(
    (departure) => new Date(departure.appointmentAt).getTime() < now.getTime() - PAST_DEPARTURE_THRESHOLD_MS,
  );

  // Tasks increment: planned/running tasks, same status scope as `upcoming`
  // above but its own query — a task and a departure are different tables,
  // never merged into one list, per the brief's binding "run on the exact
  // same machinery, but stay a distinct kind of thing" design.
  const tasksInProgress = useLiveQuery(
    () => db.tasks.where('status').anyOf(['planned', 'running']).toArray(),
    [],
  );
  // Soonest-deadline-first, deadline-less tasks last (Infinity sorts them
  // to the bottom), createdAt as the tiebreak — the ordering that puts the
  // most time-pressured task at the top of a capped, glanceable list,
  // mirroring Upcoming's own soonest-appointment-first intent above.
  const sortedTasks = useMemo(() => {
    if (!tasksInProgress) return undefined;
    return [...tasksInProgress].sort((a, b) => {
      const aDeadline = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Number.POSITIVE_INFINITY;
      const bDeadline = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Number.POSITIVE_INFINITY;
      if (aDeadline !== bDeadline) return aDeadline - bDeadline;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [tasksInProgress]);
  const visibleTasks = sortedTasks?.slice(0, MAX_VISIBLE_TASKS);
  const hiddenTasksCount = Math.max(0, (sortedTasks?.length ?? 0) - MAX_VISIBLE_TASKS);

  // templateId -> Template, for the "Repeats Mon-Fri . 08:00" line below.
  // `templates` is already fetched (top of this component) for the
  // Templates section, so this is a lookup over data already in memory,
  // not a second query.
  const templatesById = useMemo(() => {
    const map = new Map<string, Template>();
    for (const template of templates ?? []) map.set(template.id, template);
    return map;
  }, [templates]);

  // Field report #9: "we don't need to show all the upcoming repeat
  // templates populated, we can show it as one repeating event." A
  // recurring template's materialized occurrences (Departure.scheduledForDate
  // != null, see db/types.ts) are collapsed here to just the soonest one per
  // template — the rest stay exactly as real as before (still in Dexie,
  // alarms still armed, still openable individually from Runway or History)
  // but stop rendering as a run of duplicate-looking cards. A manually
  // created departure (scheduledForDate == null) is never collapsed; it has
  // no siblings to collapse with in the first place.
  const collapsedUpcoming = useMemo(() => {
    if (!upcomingDepartures) return undefined;

    const manual = upcomingDepartures.filter((departure) => departure.scheduledForDate == null);
    const auto = upcomingDepartures.filter((departure) => departure.scheduledForDate != null);

    // `upcomingDepartures` is already soonest-first (the `upcoming` query
    // above sorts by appointmentAt), so within this loop the first auto row
    // seen for a given template IS its soonest — a plain "don't overwrite"
    // Map insert is enough, no separate min-by-date pass needed.
    const soonestByTemplate = new Map<string, Departure>();
    for (const departure of auto) {
      // Every auto row's templateId is set by construction (materialize.ts's
      // buildDeparture always writes one alongside scheduledForDate) — the
      // `?? departure.id` fallback below only exists so this compiles
      // against templateId's `string | null` type without asserting it
      // away; it doesn't change grouping behaviour for a real auto row.
      const key = departure.templateId ?? departure.id;
      if (!soonestByTemplate.has(key)) soonestByTemplate.set(key, departure);
    }

    return [...manual, ...soonestByTemplate.values()].sort(
      (a, b) => new Date(a.appointmentAt).getTime() - new Date(b.appointmentAt).getTime(),
    );
  }, [upcomingDepartures]);

  /** The quiet "Repeats Mon-Fri . 08:00" line for a collapsed auto card, or
   * `null` for a manual departure (no schedule to summarize) and for the
   * orphan edge — the template was deleted, or its schedule was cleared
   * since this occurrence was materialized — where `null` here makes the
   * card render exactly like a plain manual one rather than claim a
   * schedule that no longer exists. */
  function repeatsLine(departure: Departure): string | null {
    if (departure.templateId == null) return null;
    const template = templatesById.get(departure.templateId);
    if (!template || template.schedule == null) return null;
    return `Repeats ${formatScheduleDays(template.schedule.days)} · ${template.schedule.time}`;
  }

  // Cap the rendered list, don't cap the data — `collapsedUpcoming`
  // (unsliced) is still what feeds the "N planned" count below; only the
  // JSX further down reads `visibleUpcomingDepartures`. Counting against
  // the COLLAPSED list (not raw `upcomingDepartures`) matters: the siblings
  // `collapsedUpcoming` already folded away aren't "more to scroll for" —
  // they're the same repeating event as the card already shown — so
  // counting them here would reintroduce exactly the noise this whole
  // change exists to remove, just as a number instead of as cards.
  const visibleUpcomingDepartures = collapsedUpcoming?.slice(0, MAX_VISIBLE_UPCOMING);
  const hiddenUpcomingCount = Math.max(0, (collapsedUpcoming?.length ?? 0) - MAX_VISIBLE_UPCOMING);

  // Shared by the "Remove" action on a planned Upcoming/Past card and has
  // no Runway-screen equivalent to defer to here - Home is the only place
  // this fires from for a departure that hasn't been opened yet.
  async function removeDeparture(departure: Departure) {
    if (!window.confirm(REMOVE_CONFIRM)) return;
    await db.departures.update(departure.id, { status: 'abandoned' });
    await cancelDepartureAlarms(departure.id);
    // Widgets increment: an abandoned departure is no longer eligible to be
    // the widget's source departure — refresh so a removed "Klinik 14:30"
    // doesn't linger on the home screen.
    void refreshWidgets();
    void refreshDayGauge();
  }

  // Departures that have left but have no recorded arrival result yet -
  // increment-5 §2's one-optional-tap capture. Soonest appointment first,
  // same as Upcoming, so the oldest wait is at the top.
  //
  // Arrival-steps increment: a departure WITH arrival steps is excluded
  // here — judgment call, worth flagging rather than a silent behavior
  // change. Runway.tsx's own arrival phase resolves that departure far
  // more precisely (checking the last arrival step auto-derives
  // arrivalResult from the exact checked-off timestamp against the true
  // target); offering the same departure a manual Early/On time/Late guess
  // here too would let a stray tap short-circuit that more honest capture
  // with a coarser one. Departures without arrival steps (the overwhelming
  // majority, and 100% of them before this increment) are completely
  // unaffected — `arrivalSteps.length === 0` for every one of them.
  const waitingOnArrival = useLiveQuery(
    () =>
      db.departures
        .where('status')
        .equals('left')
        .filter((departure) => (departure.arrivalSteps ?? []).length === 0)
        .sortBy('appointmentAt'),
    [],
  );

  // Field bug, real user report: "I'm out the door" on a departure WITH
  // arrival steps, then Android killed the backgrounded app mid-drive. The
  // filter just above is exactly what stranded him — it exists so an
  // arrival-steps departure resolves through Runway.tsx's own (more
  // precise) arrival phase instead of this section's coarse Early/On
  // time/Late buttons, on the assumption he'd stay on that screen through
  // the whole arrival phase. A backgrounded app dying mid-drive breaks that
  // assumption: the departure is still 'left' in Dexie, `leftAt` stamped,
  // arrival steps still there to finish, but relaunching the app lands on
  // Home, and nothing here pointed back to it. `strandedInArrival` (new,
  // src/lib/strandedArrival.ts — pulled out so it's testable without Dexie)
  // is that missing door. Covers both "hasn't tapped 'I'm at the building'
  // yet" (`arrivedAt == null`) and "arrived but didn't finish the
  // checklist" — a checklist half-done when the app died is exactly as
  // stranded as one that never started. Same soonest-appointment-first sort
  // as `waitingOnArrival` above, so the oldest stranded run sits at the top.
  //
  // These render as tappable Cards ABOVE the plain confirm-button rows
  // inside the SAME "Waiting on arrival" section (see the JSX below) — same
  // semantic, "you left, this isn't finished" — rather than a second
  // section, and this section's "no empty state" rule (see that comment,
  // unchanged) still applies: a stranded arrival simply doesn't add a row
  // when there isn't one.
  const strandedArrivals = useLiveQuery(
    () =>
      db.departures
        .where('status')
        .equals('left')
        .filter((departure) => strandedInArrival(departure))
        .sortBy('appointmentAt'),
    [],
  );

  // Everything computeSuggestions needs: templates (already fetched above)
  // and every departure that could contribute calibration history.
  const calibrationDepartures = useLiveQuery(
    () => db.departures.where('status').anyOf(['left', 'done']).toArray(),
    [],
  );

  // Bumped to force a re-render after mutating the module-level dismissed
  // set below - React has no way to know that Set mutated outside state
  // changed, so this is the cheap "please re-run this component" signal.
  const [dismissTick, setDismissTick] = useState(0);

  const suggestions = useMemo(() => {
    if (!templates || !calibrationDepartures) return [];
    // dismissTick is read only to satisfy the linter's exhaustive-deps
    // instinct that this memo depends on it - the actual dependency is the
    // mutable Set itself, which useMemo can't see.
    void dismissTick;
    return computeSuggestions(templates, calibrationDepartures)
      .filter((suggestion) => !dismissedSuggestions.has(suggestionKey(suggestion)))
      .slice(0, MAX_VISIBLE_SUGGESTIONS);
  }, [templates, calibrationDepartures, dismissTick]);

  function dismissSuggestion(suggestion: Suggestion) {
    dismissedSuggestions.add(suggestionKey(suggestion));
    setDismissTick((tick) => tick + 1);
  }

  async function applySuggestion(suggestion: Suggestion) {
    const template = await db.templates.get(suggestion.templateId);
    if (!template) return;
    // Estimation-bias increment: same "learned, this time with a tap"
    // provenance as autoLearn.ts's write-itself update — see db/types.ts's
    // StepTemplate.estimateSource comment. Found while tracing every
    // plannedMinutes write site for that increment; not on the original
    // list.
    const steps = template.steps.map((step) =>
      step.name === suggestion.stepName
        ? { ...step, minutes: suggestion.learnedMinutes, estimateSource: 'learned' as const }
        : step,
    );
    await db.templates.update(suggestion.templateId, { steps, updatedAt: new Date().toISOString() });
    // No need to also add to dismissedSuggestions - once the template step's
    // minutes match the learned estimate, computeSuggestions' own delta
    // threshold stops proposing it, so it disappears naturally on the next
    // render.
  }

  // Buffer suggestion (learning increment §3): always suggest-only, for
  // EVERY template with enough slip evidence, independent of that
  // template's own autoLearn flag - autoLearn only ever touches step
  // minutes, never the buffer, so this is the one place a buffer ever
  // changes, and it always requires a tap. Capped to the same
  // MAX_VISIBLE_SUGGESTIONS as step-time suggestions, for the same "don't
  // dump the whole list on screen at once" reason.
  const bufferSuggestions = useMemo(() => {
    if (!templates || !calibrationDepartures) return [];
    void dismissTick; // same "the Set mutation isn't visible to useMemo" reasoning as `suggestions` above
    return computeBufferSuggestions(templates, calibrationDepartures)
      .filter((suggestion) => !dismissedSuggestions.has(bufferSuggestionKey(suggestion)))
      .slice(0, MAX_VISIBLE_SUGGESTIONS);
  }, [templates, calibrationDepartures, dismissTick]);

  function dismissBufferSuggestion(suggestion: BufferSuggestion) {
    dismissedSuggestions.add(bufferSuggestionKey(suggestion));
    setDismissTick((tick) => tick + 1);
  }

  async function applyBufferSuggestion(suggestion: BufferSuggestion) {
    const template = await db.templates.get(suggestion.templateId);
    if (!template) return;
    const bufferMinutes = template.bufferMinutes + suggestion.slipMinutes;
    await db.templates.update(suggestion.templateId, { bufferMinutes, updatedAt: new Date().toISOString() });
    // Same "reach the already-planned week" chain TemplateEdit's own save
    // path and autoLearn.ts's engine both run after a template edit that
    // future auto-created departures need to inherit.
    await replaceUntouchedFutureAutoRows(suggestion.templateId);
    await materializeScheduledDepartures();
  }

  // Early/On time close the loop with no extra input. Late reveals a
  // minutes field inline on the same card rather than navigating anywhere -
  // increment-5 §2 calls this "one optional tap", and a second screen would
  // make it two. Skip records nothing (arrivalResult stays null) - allowed
  // by design so this section can never turn into a guilt list.
  const [revealingLateFor, setRevealingLateFor] = useState<string | null>(null);
  const [lateMinutesInput, setLateMinutesInput] = useState('');

  // Widgets increment: all three arrival-capture writes below move the
  // departure's status to 'done', which takes it out of the widget's
  // planned/running source pool — each refreshes so a captured departure
  // doesn't keep showing as "next" on the home screen.
  //
  // Learning increment §3: each also fires applyAutoLearn - the departure
  // already reached 'left' when it entered "Waiting on arrival"
  // (Runway.tsx's handleLeave already fired it once at that point), so
  // this second fire-and-forget call is idempotent in practice (no new
  // step actuals appear between 'left' and 'done'); it's here anyway
  // because the spec's trigger is "reaches left/done," not just the first
  // of the two, and a no-op recompute costs nothing.
  async function recordArrival(departure: Departure, result: 'early' | 'onTime') {
    await db.departures.update(departure.id, { status: 'done', arrivalResult: result, arrivalLateMinutes: null });
    void refreshWidgets();
    void refreshDayGauge();
    if (departure.templateId) void applyAutoLearn(departure.templateId);
  }

  async function confirmLate(departure: Departure) {
    const minutes = Number.parseInt(lateMinutesInput, 10);
    if (Number.isNaN(minutes) || minutes < 0) return;
    await db.departures.update(departure.id, { status: 'done', arrivalResult: 'late', arrivalLateMinutes: minutes });
    setRevealingLateFor(null);
    setLateMinutesInput('');
    void refreshWidgets();
    void refreshDayGauge();
    if (departure.templateId) void applyAutoLearn(departure.templateId);
  }

  async function skipArrival(departure: Departure) {
    await db.departures.update(departure.id, { status: 'done' });
    void refreshWidgets();
    void refreshDayGauge();
    if (departure.templateId) void applyAutoLearn(departure.templateId);
  }

  // Quick-capture increment (E2). `undefined` while the settings read is
  // still in flight is treated as "no key" (same convention as every other
  // config-gated section on this screen) — the capture box simply doesn't
  // render for that one tick rather than flashing in once the query
  // resolves. Read via useLiveQuery (not local state) so saving a key on
  // Settings and returning to Home picks it up immediately, no separate
  // sync needed — same reasoning as liveTravelConfig in DepartureSetup.tsx.
  const captureConfig = useLiveQuery(() => readCaptureConfig(), []);
  const captureAvailable = (captureConfig?.apiKey ?? '') !== '';

  const [captureText, setCaptureText] = useState('');
  const [capturePending, setCapturePending] = useState(false);
  // The reason a parse failed, shown in small faint text beneath the fixed
  // "Could not parse that" line — null means no failure to show. Cleared on
  // the next edit so a stale reason doesn't sit under a sentence the person
  // has already changed.
  const [captureFailureReason, setCaptureFailureReason] = useState<string | null>(null);

  function updateCaptureText(value: string) {
    setCaptureText(value);
    setCaptureFailureReason(null);
  }

  // Explicit tap (or Enter) only, same "never automatic" rule as
  // DepartureSetup's handleFetchLiveTravel above — a network call to
  // Google, carrying the dictated sentence, only ever fires because the
  // person asked it to. The result is ALWAYS a draft dropped into
  // DepartureSetup for confirmation, never a saved departure — this
  // handler itself never touches db.departures.
  async function handleCaptureParse() {
    const text = captureText.trim();
    if (text === '' || !captureConfig?.apiKey || capturePending) return;

    setCapturePending(true);
    setCaptureFailureReason(null);
    try {
      const result = await captureDeparture(text, new Date(), captureConfig.apiKey);
      if (!result.ok) {
        setCaptureFailureReason(result.reason);
        return;
      }

      const { draft } = result;
      setCaptureText('');
      if (draft.time !== '') {
        // A time was heard — combine date+time into the same local-wall-time
        // -> ISO conversion DepartureSetup's own handleSave uses, so this
        // reads as an ordinary appointment prefill (prefillAppointmentIso),
        // no different from the calendar-read path (E1) that already uses
        // the same prop.
        onNavigate({
          name: 'departureSetup',
          prefillName: draft.name,
          prefillDestination: draft.destination,
          prefillAppointmentIso: new Date(`${draft.date}T${draft.time}:00`).toISOString(),
        });
      } else {
        // No time was heard — prefillDate/prefillTimeMissing (App.tsx's
        // Screen union) fills only the date, leaves Time genuinely blank,
        // and shows DepartureSetup's "No time was heard" note rather than
        // silently guessing a time that was never dictated.
        onNavigate({
          name: 'departureSetup',
          prefillName: draft.name,
          prefillDestination: draft.destination,
          prefillDate: draft.date,
          prefillTimeMissing: true,
        });
      }
    } finally {
      setCapturePending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 pb-12 pt-safe-top">
      <header className="pt-8">
        <h1 className="text-2xl font-semibold text-slate-100">Runway</h1>
      </header>

      {showFirstRunCard && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
          <h2 className="font-medium text-slate-100">Before your first departure</h2>
          <p className="text-sm text-slate-400">
            Runway wakes you through a departure with scheduled alarms. Two Android settings decide
            whether they arrive on time:
          </p>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-slate-400">
            <li>Allow notifications when Runway asks — this happens when you save your first departure.</li>
            <li>
              In Settings → Apps → Runway → Battery, choose Unrestricted. Samsung&apos;s battery
              optimizer defers alarms otherwise.
            </li>
          </ol>
          <Button onClick={() => void dismissFirstRunCard()} className="mt-1">
            Done — don&apos;t show this again.
          </Button>
        </div>
      )}

      {exactAlarmsOff && !bannerDismissed && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-700/60 bg-amber-950/40 p-4">
          <p className="flex-1 text-sm text-amber-200">
            Exact alarms are off for Runway. Scheduled alerts may arrive late or not at all.
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => void openExactAlarmSettings()}
              className="min-h-12 rounded-lg px-2 text-sm font-medium text-amber-300 transition-colors hover:text-amber-200"
            >
              Open settings
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss"
              className="flex min-h-12 min-w-12 items-center justify-center text-amber-500 transition-colors hover:text-amber-300"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* B1: distinct from the exact-alarm banner above - a denied
          notification permission means alerts never appear at all, not
          just late, and there's no "open settings" plugin call for this one
          (only for the exact-alarm toggle), so no button — just the
          instruction in the copy itself. */}
      {notificationsDenied && !notificationBannerDismissed && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-700/60 bg-amber-950/40 p-4">
          <p className="flex-1 text-sm text-amber-200">
            Notifications are off for Runway. Scheduled alerts will not appear. Allow notifications in
            Settings, Apps, Runway, Notifications.
          </p>
          <button
            onClick={() => setNotificationBannerDismissed(true)}
            aria-label="Dismiss"
            className="flex min-h-12 min-w-12 shrink-0 items-center justify-center text-amber-500 transition-colors hover:text-amber-300"
          >
            &times;
          </button>
        </div>
      )}

      {/* Quick-capture increment (E2). Only rendered once a Gemini key
          exists (CLAUDE.md/App brief: no dead UI without a key) — there's
          nothing this box could do without one, so it doesn't get the
          usual "off, with an explanation" treatment other gated sections
          on this screen use; Settings is where that explanation lives. */}
      {captureAvailable && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={captureText}
              onChange={(e) => updateCaptureText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCaptureParse();
                // CLAUDE.md: "Esc to clear" for capture inputs.
                if (e.key === 'Escape') updateCaptureText('');
              }}
              placeholder="Dictate a departure — name, day, time, place."
              enterKeyHint="go"
              disabled={capturePending}
              aria-label="Dictate a departure"
              className="min-h-12 flex-1 rounded-lg border border-slate-700 bg-raised px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none disabled:opacity-50"
            />
            <TextAction
              onClick={() => void handleCaptureParse()}
              disabled={capturePending || captureText.trim() === ''}
              className="disabled:opacity-40"
            >
              {capturePending ? 'Parsing.' : 'Parse'}
            </TextAction>
          </div>
          {captureFailureReason !== null && (
            <div>
              <p className="text-sm text-amber-400">Could not parse that — try again or enter it manually.</p>
              <p className="text-sm text-slate-500">{captureFailureReason}</p>
            </div>
          )}
        </div>
      )}

      {/* Departure and task creation are peer entry points (a field request:
          "the task should get a button as prominent as the departure
          button") — both PRIMARY, side by side. Button.tsx's own comment
          calls primary "the one action per screen that matters"; this row
          deliberately breaks that rule. The tradeoff: two primary buttons
          dilute the "one action" signal the design system otherwise relies
          on, but the alternative — one primary, one secondary — is exactly
          the second-class visual this change exists to remove. */}
      <div className="flex gap-3">
        <Button onClick={() => onNavigate({ name: 'departureSetup' })} className="flex-1">
          New departure
        </Button>
        <Button onClick={() => onNavigate({ name: 'taskSetup' })} className="flex-1">
          New task
        </Button>
      </div>

      {/* Tasks increment: timed work without travel, run on the same live-
          projection/check-off machinery as a departure. Creation now lives
          in the two-up button row above, so this header is just the
          section label — no duplicate "New task" action a few lines below
          the one that already exists (CLAUDE.md: defaults lean smaller).
          The header and the quiet "No tasks in progress." line still render
          when empty (a genuine affordance to discover, not a guilt list) —
          unlike Waiting on arrival just below, which deliberately has no
          empty state at all (see that section's own comment). */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Tasks</h2>

        {tasksInProgress?.length === 0 && <p className="text-sm text-slate-500">No tasks in progress.</p>}

        <div className="flex flex-col gap-2">
          {visibleTasks?.map((task) => {
            const checkedCount = task.units.filter((unit) => unit.checkedAt !== null).length;
            const projection = taskProjection(now, task);
            return (
              <Card key={task.id} onClick={() => onNavigate({ name: 'task', taskId: task.id })}>
                <p className="text-xl font-medium text-slate-100">{task.name}</p>
                <p className="text-sm text-slate-400">
                  {checkedCount} of {task.units.length} units
                </p>
                <p className="mt-1 text-sm tabular-nums text-slate-500">
                  {task.deadlineAt
                    ? `Deadline ${formatTime(new Date(task.deadlineAt))} · ${formatSlackLine(projection.slackMinutes ?? 0, 'past the deadline')}`
                    : `Finishes ${formatTime(projection.projectedFinish)}`}
                </p>
              </Card>
            );
          })}
        </div>

        {hiddenTasksCount > 0 && <p className="text-sm text-slate-500">+{hiddenTasksCount} more</p>}
      </section>

      {/* No empty state here on purpose — a departure only ever appears in
          this section for as long as it's genuinely waiting, and "Skip"
          clears one instantly. Showing "nothing waiting" text when it's
          empty would make an absence into a thing to notice, which is
          exactly the guilt-list shape increment-5 §2 rules out. */}
      {((waitingOnArrival && waitingOnArrival.length > 0) ||
        (strandedArrivals && strandedArrivals.length > 0)) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
            Waiting on arrival
          </h2>
          <div className="flex flex-col gap-2">
            {/* Stranded arrival-steps departures, above the plain
                confirm-button rows below — these are tappable because
                there's a real checklist to resume on Runway, not a single
                Early/On time/Late guess to make right here. */}
            {strandedArrivals?.map((departure) => (
              <Card
                key={departure.id}
                onClick={() => onNavigate({ name: 'runway', departureId: departure.id })}
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium text-slate-100">{departure.name}</p>
                  <p className="text-sm tabular-nums text-slate-500">
                    {formatAppointmentLine(new Date(departure.appointmentAt), now)}
                  </p>
                </div>
                <p className="mt-1 text-sm text-slate-400">{strandedArrivalLine(departure)}</p>
              </Card>
            ))}
            {waitingOnArrival?.map((departure) => (
              <div key={departure.id} className="rounded-xl border border-slate-800/60 bg-surface p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-slate-100">{departure.name}</p>
                  <p className="text-sm tabular-nums text-slate-500">
                    {formatAppointmentLine(new Date(departure.appointmentAt), now)}
                  </p>
                </div>

                {revealingLateFor === departure.id ? (
                  <div className="mt-3 flex items-center gap-2 motion-safe:animate-fade-in">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      autoFocus
                      value={lateMinutesInput}
                      onChange={(e) => setLateMinutesInput(e.target.value)}
                      placeholder="min"
                      aria-label="Minutes late"
                      className="min-h-12 w-20 rounded-lg border border-slate-700 bg-raised px-2 py-2 text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
                    />
                    <Button onClick={() => void confirmLate(departure)} className="flex-1">
                      Confirm
                    </Button>
                    <TextAction
                      onClick={() => {
                        setRevealingLateFor(null);
                        setLateMinutesInput('');
                      }}
                    >
                      Cancel
                    </TextAction>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2">
                    <Button variant="secondary" onClick={() => void recordArrival(departure, 'early')} className="flex-1">
                      Early
                    </Button>
                    <Button variant="secondary" onClick={() => void recordArrival(departure, 'onTime')} className="flex-1">
                      On time
                    </Button>
                    <Button variant="secondary" onClick={() => setRevealingLateFor(departure.id)} className="flex-1">
                      Late
                    </Button>
                    <TextAction onClick={() => void skipArrival(departure)}>Skip</TextAction>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Calendar increment (E1). Native only — there is no device calendar
          to read on web/dev. Two mutually exclusive branches: the
          never-asked prompt (one quiet TextAction, no events fetched yet)
          and the loaded list (only once enabled AND there's at least one
          event left after dedup) — a 'false' settings row (declined or
          turned off in Settings) renders neither, same "no empty state,
          no nagging" shape as Waiting on arrival above: an absence here
          is not a thing to comment on. */}
      {Capacitor.isNativePlatform() && calendarNeverAsked && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
            From your calendar
          </h2>
          <TextAction onClick={() => void enableCalendar()} className="self-start">
            Show calendar appointments here.
          </TextAction>
        </section>
      )}

      {Capacitor.isNativePlatform() && calendarEnabled && visibleCalendarEvents.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
            From your calendar
          </h2>
          <div className="flex flex-col gap-2">
            {visibleCalendarEvents.map((event) => {
              // Calendar-recurrence increment (field report #10 §1): a
              // weekly-repeating calendar event ("Fortbildung", every
              // Friday) previously looked identical to a one-off one here —
              // the app read the event but never surfaced that it repeats,
              // and "Plan departure" produced a plain one-off departure
              // with no way to make it repeat too. `parsedRrule` is `null`
              // for a genuinely one-off event AND for an RRULE shape this
              // app doesn't project onto its own weekly TemplateSchedule
              // model (see rrule.ts's own doc comment) — both render
              // exactly like today, no faint line, no repeat prefill.
              const parsedRrule = parseWeeklyRrule(event.rrule);
              return (
                <div
                  key={`${event.beginEpochMs}-${event.title}`}
                  className="rounded-xl border border-slate-800/60 bg-surface p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-100">{event.title || 'Untitled event'}</p>
                    <p className="text-sm tabular-nums text-slate-500">
                      {formatDateTimeShort(new Date(event.beginEpochMs), now)}
                    </p>
                  </div>
                  {event.location !== '' && <p className="text-sm text-slate-400">{event.location}</p>}
                  {parsedRrule && (
                    <p className="text-sm text-slate-500">
                      Repeats {formatScheduleDays(parsedRrule.days)} in your calendar.
                    </p>
                  )}
                  <div className="mt-3">
                    <TextAction
                      onClick={() =>
                        onNavigate({
                          name: 'departureSetup',
                          prefillName: event.title,
                          prefillAppointmentIso: new Date(event.beginEpochMs).toISOString(),
                          ...(parsedRrule ? { prefillRepeatDays: parsedRrule.days } : {}),
                        })
                      }
                    >
                      Plan departure
                    </TextAction>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="flex flex-col gap-3">
          {suggestions.map((suggestion) => (
            <div
              key={suggestionKey(suggestion)}
              className="rounded-xl border border-sky-800/60 bg-sky-950/30 p-4"
            >
              <p className="text-sm text-slate-200">
                You plan {suggestion.plannedMinutes} min for {suggestion.stepName}. {suggestion.learnedMinutes} min
                covers 3 of 4 of your last {suggestion.runCount} runs.
              </p>
              <div className="mt-3 flex gap-2">
                <Button onClick={() => void applySuggestion(suggestion)} className="flex-1">
                  Update to {suggestion.learnedMinutes} min
                </Button>
                <Button variant="secondary" onClick={() => dismissSuggestion(suggestion)} className="flex-1">
                  Not now
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Buffer suggestion (learning increment §3) — always suggest-only,
          same visual treatment as the step-time cards above but its own
          section so the two never interleave confusingly under one
          heading-less block. */}
      {bufferSuggestions.length > 0 && (
        <section className="flex flex-col gap-3">
          {bufferSuggestions.map((suggestion) => (
            <div
              key={bufferSuggestionKey(suggestion)}
              className="rounded-xl border border-sky-800/60 bg-sky-950/30 p-4"
            >
              <p className="text-sm text-slate-200">
                You typically leave {suggestion.slipMinutes} min after your planned time. Add {suggestion.slipMinutes}{' '}
                min to the buffer?
              </p>
              <div className="mt-3 flex gap-2">
                <Button onClick={() => void applyBufferSuggestion(suggestion)} className="flex-1">
                  Add {suggestion.slipMinutes} min
                </Button>
                <Button variant="secondary" onClick={() => dismissBufferSuggestion(suggestion)} className="flex-1">
                  Not now
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Templates</h2>
          <TextAction onClick={() => onNavigate({ name: 'templateEdit' })}>New template</TextAction>
        </div>

        {templates?.length === 0 && (
          <p className="text-sm text-slate-500">No templates yet.</p>
        )}

        <div className="flex flex-col gap-2">
          {templates?.map((template) => {
            const totalPrepMinutes = template.steps.reduce((sum, step) => sum + step.minutes, 0);
            return (
              <div key={template.id} className="flex items-center gap-2">
                <Card
                  onClick={() => onNavigate({ name: 'departureSetup', templateId: template.id })}
                  className="flex-1"
                >
                  <p className="text-xl font-medium text-slate-100">{template.name}</p>
                  <p className="text-sm text-slate-400">
                    {template.destination || 'No destination set'}
                  </p>
                  <p className="mt-1 text-sm tabular-nums text-slate-500">
                    {totalPrepMinutes} min prep &middot; {template.travelMinutes} min travel
                  </p>
                </Card>
                <TextAction
                  onClick={() => onNavigate({ name: 'templateEdit', id: template.id })}
                  aria-label={`Edit ${template.name}`}
                >
                  Edit
                </TextAction>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Upcoming</h2>

        {upcoming?.length === 0 && (
          <p className="text-sm text-slate-500">No departure planned.</p>
        )}

        <div className="flex flex-col gap-2">
          {visibleUpcomingDepartures?.map((departure) => {
            const repeats = repeatsLine(departure);
            return (
              <div key={departure.id} className="flex flex-col gap-1">
                <Card onClick={() => onNavigate({ name: 'runway', departureId: departure.id })}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xl font-medium text-slate-100">{departure.name}</p>
                        {departure.status === 'running' && (
                          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-sky-400">
                            Running
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-400">{departure.destination || 'No destination set'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold tabular-nums text-slate-100">
                        {formatTime(new Date(departure.appointmentAt))}
                      </p>
                      <p className="text-sm text-slate-500">
                        {formatDateDisplay(new Date(departure.appointmentAt))}
                      </p>
                    </div>
                  </div>
                  {/* Field report #9: this card stands in for every occurrence
                      of the template collapsed into it (see `collapsedUpcoming`
                      above) - this line is the only thing on screen that says
                      so, since the card otherwise looks identical to a
                      one-off departure. */}
                  {repeats && <p className="mt-1 text-sm text-slate-500">{repeats}</p>}
                </Card>
                {/* Quiet secondary actions. These sit outside the Card
                    <button> rather than nested inside it - a <button> inside a
                    <button> is invalid HTML and Card is already a button.
                    F3 (recover-instead-of-forfeit spec): Edit is now offered
                    for 'running' cards too, not just 'planned' - editing a
                    running departure is for when REALITY moved (the Termin
                    got pushed back, a step turned out to need longer than
                    planned) and DepartureSetup's own edit path locks already-
                    checked steps so that isn't a rewrite of history, just a
                    correction to what's still ahead (see DepartureSetup.tsx).
                    Remove stays 'planned'-only, unchanged from M1/M2: a
                    'running' departure's equivalent action is Runway's own
                    "Abandon this departure", already reachable from the
                    screen you'd be on to check a running departure's
                    progress - duplicating it here would just be a second
                    path to the same confirm dialog. */}
                {(departure.status === 'planned' || departure.status === 'running') && (
                  <div className="flex justify-end gap-1 px-1">
                    <TextAction onClick={() => onNavigate({ name: 'departureSetup', departureId: departure.id })}>
                      Edit
                    </TextAction>
                    {/* Field report #10 §3: "Make repeating" promotes a
                        one-off departure into a Template with a schedule,
                        instead of the app ever running a second scheduler
                        on the departure itself (this fix's binding design
                        decision - ONE recurrence engine, templates). Only
                        offered for a departure that ISN'T already tied to
                        one - `templateId == null` is exactly the set of
                        departures with nothing to promote FROM otherwise
                        (a template-linked departure already has its
                        template's own Edit/Repeat controls, reachable via
                        the Templates section above). 'planned'-only, same
                        scope as Remove just below - a 'running' departure
                        is already under way; TemplateEdit's own
                        `fromDepartureId` prefill isn't built to read a
                        run's already-checked steps. */}
                    {departure.status === 'planned' && departure.templateId == null && (
                      <TextAction
                        onClick={() => onNavigate({ name: 'templateEdit', fromDepartureId: departure.id })}
                      >
                        Make repeating
                      </TextAction>
                    )}
                    {departure.status === 'planned' && (
                      <TextAction onClick={() => void removeDeparture(departure)}>Remove</TextAction>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {hiddenUpcomingCount > 0 && (
          <p className="text-sm text-slate-500">+{hiddenUpcomingCount} more planned</p>
        )}
      </section>

      {/* M4: appointments that slipped more than an hour into the past
          without being started, checked, or abandoned - dimmed and
          demoted below Upcoming rather than mixed into it, so a missed
          appointment from this morning doesn't bury today's actual next
          departure. */}
      {pastDepartures && pastDepartures.length > 0 && (
        <section className="flex flex-col gap-3 opacity-60">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Past departure time</h2>
          <div className="flex flex-col gap-2">
            {pastDepartures.map((departure) => (
              <div key={departure.id} className="rounded-xl border border-slate-800/60 bg-surface p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-100">{departure.name}</p>
                    <p className="text-sm text-slate-400">{departure.destination || 'No destination set'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums text-slate-100">
                      {formatTime(new Date(departure.appointmentAt))}
                    </p>
                    <p className="text-sm text-slate-500">
                      {formatDateDisplay(new Date(departure.appointmentAt))}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => onNavigate({ name: 'runway', departureId: departure.id })}
                    className="flex-1"
                  >
                    Open
                  </Button>
                  <TextAction onClick={() => void removeDeparture(departure)}>Remove</TextAction>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center justify-center gap-6">
        <TextAction onClick={() => onNavigate({ name: 'history' })}>History</TextAction>
        <TextAction onClick={() => onNavigate(exam ? { name: 'exam' } : { name: 'examSetup' })}>Prüfung</TextAction>
        <TextAction onClick={() => onNavigate({ name: 'settings' })}>Settings</TextAction>
        <TextAction onClick={() => onNavigate({ name: 'report', fromScreen: 'home' })}>Report a problem</TextAction>
      </div>
    </div>
  );
}
