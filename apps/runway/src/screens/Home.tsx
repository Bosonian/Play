import { useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Departure } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { formatDateDisplay, formatTime } from '../lib/format';
import { getExactAlarmStatus, openExactAlarmSettings } from '../native/notifications';
import { computeSuggestions } from '../lib/calibration';
import type { Suggestion } from '../lib/calibration';

interface HomeProps {
  onNavigate: (screen: Screen) => void;
}

/** Cap on suggestions shown at once (increment-5 spec §4: "defaults lean
 * toward less, not more"). Any beyond the cap simply wait for a future
 * visit - nothing is lost, they're just not all dumped on screen together. */
const MAX_VISIBLE_SUGGESTIONS = 2;

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

/** Key into the `settings` table (db/db.ts v2) for the first-run card's
 * dismissal — see the "Done — don't show this again" handler below. */
const FIRST_RUN_DISMISSED_KEY = 'firstRunDismissed';

export function Home({ onNavigate }: HomeProps) {
  const templates = useLiveQuery(() => db.templates.toArray(), []);

  // undefined while the settings row is still loading (first Dexie read
  // after app open) — the card stays hidden during that instant rather
  // than flashing on then off, since undefined !== 'true' would otherwise
  // read as "not dismissed yet" for one render.
  const firstRunSetting = useLiveQuery(() => db.settings.get(FIRST_RUN_DISMISSED_KEY), []);
  const showFirstRunCard =
    Capacitor.isNativePlatform() && firstRunSetting !== undefined && firstRunSetting?.value !== 'true';

  async function dismissFirstRunCard() {
    await db.settings.put({ key: FIRST_RUN_DISMISSED_KEY, value: 'true' });
  }

  // Checked once per Home mount, native only. "Dismissable-per-session"
  // (increment-4 §6) means exactly that — plain component state, not
  // persisted to Dexie or localStorage, so the banner is back next time the
  // app is reopened if the setting is still off. Deliberately not re-checked
  // on every render: the user has to leave Android settings and come back to
  // change it, which already remounts Home along the way.
  const [exactAlarmsOff, setExactAlarmsOff] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void getExactAlarmStatus().then((status) => setExactAlarmsOff(status !== 'granted'));
  }, []);

  // planned/running departures, soonest appointment first — that ordering
  // is what makes "Upcoming" useful at a glance rather than a junk drawer.
  const upcoming = useLiveQuery(
    () =>
      db.departures
        .where('status')
        .anyOf(['planned', 'running'])
        .sortBy('appointmentAt'),
    [],
  );

  // Departures that have left but have no recorded arrival result yet -
  // increment-5 §2's one-optional-tap capture. Soonest appointment first,
  // same as Upcoming, so the oldest wait is at the top.
  const waitingOnArrival = useLiveQuery(
    () => db.departures.where('status').equals('left').sortBy('appointmentAt'),
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
    const steps = template.steps.map((step) =>
      step.name === suggestion.stepName ? { ...step, minutes: suggestion.medianActualMinutes } : step,
    );
    await db.templates.update(suggestion.templateId, { steps, updatedAt: new Date().toISOString() });
    // No need to also add to dismissedSuggestions - once the template step's
    // minutes match the median, computeSuggestions' own delta threshold
    // stops proposing it, so it disappears naturally on the next render.
  }

  // Early/On time close the loop with no extra input. Late reveals a
  // minutes field inline on the same card rather than navigating anywhere -
  // increment-5 §2 calls this "one optional tap", and a second screen would
  // make it two. Skip records nothing (arrivalResult stays null) - allowed
  // by design so this section can never turn into a guilt list.
  const [revealingLateFor, setRevealingLateFor] = useState<string | null>(null);
  const [lateMinutesInput, setLateMinutesInput] = useState('');

  async function recordArrival(departure: Departure, result: 'early' | 'onTime') {
    await db.departures.update(departure.id, { status: 'done', arrivalResult: result, arrivalLateMinutes: null });
  }

  async function confirmLate(departure: Departure) {
    const minutes = Number.parseInt(lateMinutesInput, 10);
    if (Number.isNaN(minutes) || minutes < 0) return;
    await db.departures.update(departure.id, { status: 'done', arrivalResult: 'late', arrivalLateMinutes: minutes });
    setRevealingLateFor(null);
    setLateMinutesInput('');
  }

  async function skipArrival(departure: Departure) {
    await db.departures.update(departure.id, { status: 'done' });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 pb-12 pt-safe-top">
      <header className="pt-8">
        <h1 className="text-2xl font-semibold text-slate-100">Runway</h1>
      </header>

      {showFirstRunCard && (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium text-slate-100">Before your first departure</h2>
          <p className="text-sm text-slate-300">
            Runway wakes you through a departure with scheduled alarms. Two Android settings decide
            whether they arrive on time:
          </p>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-slate-300">
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
        <div className="flex items-start gap-3 rounded-lg border border-amber-700/60 bg-amber-950/40 px-4 py-3">
          <p className="flex-1 text-sm text-amber-200">
            Exact alarms are off for Runway. Scheduled alerts may arrive late or not at all.
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => void openExactAlarmSettings()}
              className="min-h-11 rounded-md px-2 text-sm font-medium text-amber-300 hover:text-amber-200"
            >
              Open settings
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss"
              className="flex min-h-11 min-w-11 items-center justify-center text-amber-500 hover:text-amber-300"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      <Button onClick={() => onNavigate({ name: 'departureSetup' })} className="w-full">
        New departure
      </Button>

      {/* No empty state here on purpose — a departure only ever appears in
          this section for as long as it's genuinely waiting, and "Skip"
          clears one instantly. Showing "nothing waiting" text when it's
          empty would make an absence into a thing to notice, which is
          exactly the guilt-list shape increment-5 §2 rules out. */}
      {waitingOnArrival && waitingOnArrival.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
            Waiting on arrival
          </h2>
          <div className="flex flex-col gap-2">
            {waitingOnArrival.map((departure) => (
              <div key={departure.id} className="rounded-md border border-slate-800 bg-slate-900 p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-slate-100">{departure.name}</p>
                  <p className="text-sm tabular-nums text-slate-500">
                    Appointment {formatTime(new Date(departure.appointmentAt))}
                  </p>
                </div>

                {revealingLateFor === departure.id ? (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      autoFocus
                      value={lateMinutesInput}
                      onChange={(e) => setLateMinutesInput(e.target.value)}
                      placeholder="min"
                      aria-label="Minutes late"
                      className="min-h-11 w-20 rounded-md border border-slate-800 bg-slate-950 px-2 py-2 text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
                    />
                    <Button onClick={() => void confirmLate(departure)} className="flex-1">
                      Confirm
                    </Button>
                    <button
                      onClick={() => {
                        setRevealingLateFor(null);
                        setLateMinutesInput('');
                      }}
                      className="min-h-11 rounded-md px-3 text-sm font-medium text-slate-500 hover:text-slate-200"
                    >
                      Cancel
                    </button>
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
                    <button
                      onClick={() => void skipArrival(departure)}
                      className="min-h-11 rounded-md px-2 text-sm font-medium text-slate-500 hover:text-slate-300"
                    >
                      Skip
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="flex flex-col gap-3">
          {suggestions.map((suggestion) => (
            <div
              key={suggestionKey(suggestion)}
              className="rounded-md border border-sky-800/60 bg-sky-950/30 p-3"
            >
              <p className="text-sm text-slate-200">
                You plan {suggestion.plannedMinutes} min for {suggestion.stepName}; your median over{' '}
                {suggestion.runCount} runs is {suggestion.medianActualMinutes} min.
              </p>
              <div className="mt-3 flex gap-2">
                <Button onClick={() => void applySuggestion(suggestion)} className="flex-1">
                  Update to {suggestion.medianActualMinutes} min
                </Button>
                <Button variant="secondary" onClick={() => dismissSuggestion(suggestion)} className="flex-1">
                  Not now
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Templates</h2>
          <button
            onClick={() => onNavigate({ name: 'templateEdit' })}
            className="min-h-11 rounded-md px-2 text-sm font-medium text-sky-400 hover:text-sky-300"
          >
            New template
          </button>
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
                  <p className="font-medium text-slate-100">{template.name}</p>
                  <p className="text-sm text-slate-400">
                    {template.destination || 'No destination set'}
                  </p>
                  <p className="mt-1 text-sm tabular-nums text-slate-500">
                    {totalPrepMinutes} min prep &middot; {template.travelMinutes} min travel
                  </p>
                </Card>
                <button
                  onClick={() => onNavigate({ name: 'templateEdit', id: template.id })}
                  aria-label={`Edit ${template.name}`}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-500 hover:text-slate-200"
                >
                  Edit
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Upcoming</h2>

        {upcoming?.length === 0 && (
          <p className="text-sm text-slate-500">No departure planned.</p>
        )}

        <div className="flex flex-col gap-2">
          {upcoming?.map((departure) => (
            <Card
              key={departure.id}
              onClick={() => onNavigate({ name: 'runway', departureId: departure.id })}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-100">{departure.name}</p>
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
            </Card>
          ))}
        </div>
      </section>

      <button
        onClick={() => onNavigate({ name: 'history' })}
        className="min-h-11 self-center text-sm font-medium text-slate-500 hover:text-slate-300"
      >
        History
      </button>
    </div>
  );
}
