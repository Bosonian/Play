import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { TextAction } from '../ui/TextAction';
import { bodyFatTrend, currentTrend, formatBodyFatTrendLine, formatTrendLine, MIN_POINTS } from '../lib/trend';
import { APP_VERSION, APP_VERSION_CODE } from '../lib/appVersion';
import { AVAILABLE_UPDATE_SETTING, parseAvailableUpdate } from '../lib/updateCheck';
import { logEvent } from '../lib/eventLog';
import { formatMovementLine, localDateKey } from '../lib/healthSync';

interface HomeProps {
  onNavigate: (screen: Screen) => void;
}

/** Session-only, module-level (not component state, not persisted) —
 * mirrors Runway's own `dismissedUpdateVersions` (Home.tsx there): "Not now"
 * should hide the card for the rest of this session without suppressing it
 * forever, and a fresh app open is a fair moment to remind again. Keyed by
 * versionCode (not the string) for the same reason Runway's is: a
 * versionCode is what actually changes across releases in a way a mutable
 * Set's membership check should key on. */
const dismissedUpdateVersions = new Set<number>();

/** The trend headline is the north star (TIDE_PLAN.md §2/§5) — Home exists
 * almost entirely to show it. Everything else on this screen (the "Add
 * weigh-in" action, the quiet links) is scaffolding around that one
 * number. */
export function Home({ onNavigate }: HomeProps) {
  // Ascending by `at` (the indexed field) so `currentTrend` receives
  // chronological input directly — trendSeries would re-sort it anyway
  // (it makes no ordering assumption about its input), but reading it
  // pre-sorted means there's one less thing to reason about at the call
  // site.
  const weighIns = useLiveQuery(() => db.weighIns.orderBy('at').toArray(), []);

  // Health Connect bridge increment (0.3.0): today's movement row, keyed by
  // the device-local calendar day (localDateKey — see healthSync.ts's own
  // comment on why this can't be a UTC date string). `[]` deps means this
  // re-subscribes once per mount, not once per render — a genuine
  // day-rollover while the app stays open in the background is an accepted,
  // rare edge case (same "re-open picks up reality" tradeoff Runway's own
  // day-boundary reads make), not one this screen actively watches for.
  const todayMovement = useLiveQuery(() => db.movement.get(localDateKey()), []);

  // Increment 2: same re-guard-at-render reasoning as Runway's own Home.tsx
  // — checkForUpdate (main.tsx startup, 6h-throttled) is what actually
  // writes this row; Home only ever reads it, and re-checks the versionCode
  // HERE rather than trusting the row on its own, because a phone that just
  // installed the exact build this row was advertising still has the OLD
  // row sitting in Dexie until the next check overwrites or clears it.
  const availableUpdateSetting = useLiveQuery(() => db.settings.get(AVAILABLE_UPDATE_SETTING), []);
  const availableUpdate = parseAvailableUpdate(availableUpdateSetting?.value);
  // Bumped to force a re-render after mutating the module-level dismissed
  // set below — React has no way to know that Set mutated outside state
  // changed, so this is the cheap "please re-run this component" signal.
  // Same mechanism Runway's own Home.tsx uses for its dismissed-suggestion
  // sets.
  const [dismissTick, setDismissTick] = useState(0);
  void dismissTick;
  const showUpdateCard =
    availableUpdate !== null &&
    availableUpdate.versionCode > APP_VERSION_CODE &&
    !dismissedUpdateVersions.has(availableUpdate.versionCode);

  function dismissUpdateCard(versionCode: number) {
    dismissedUpdateVersions.add(versionCode);
    setDismissTick((tick) => tick + 1);
  }

  function downloadUpdate(version: string) {
    // _blank, same as Runway's own downloadUpdate — v1 scope is
    // download-via-browser only; an in-app APK download + self-install
    // (REQUEST_INSTALL_PACKAGES) is deliberately deferred, same call Runway
    // made (see its CHANGELOG.md).
    window.open('https://github.com/Bosonian/Play/releases/download/tide-latest/tide-latest.apk', '_blank');
    void logEvent('update', `Update download opened: v${version}.`);
  }

  // `undefined` while useLiveQuery's first read is still pending (Dexie
  // hasn't resolved yet) — distinct from `[]`, an empty table. Rendering
  // nothing in that brief window (rather than flashing the empty state and
  // then the real one) avoids a one-frame flicker on cold start.
  if (weighIns === undefined) {
    return <div className="mx-auto min-h-screen max-w-lg px-4 pt-safe-top" />;
  }

  const trend = currentTrend(weighIns);
  // Secondary to the weight trend above — TIDE_PLAN.md §5.2's "same
  // treatment, secondary" — so it renders only once it clears its OWN
  // evidence floor (bodyFatTrend returns null under MIN_POINTS *readings*,
  // not weigh-ins; see trend.ts's own doc comment) and never gets an empty-
  // state placeholder of its own the way the weight trend does above: a
  // secondary signal with nothing to show yet should just be absent, not
  // occupy space asking for more data on a number Deepak may not even be
  // tracking via a BIA-capable scale.
  const bfTrend = bodyFatTrend(weighIns);
  const movementLine = todayMovement ? formatMovementLine(todayMovement) : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 pb-12 pt-safe-top">
      {/* Placed FIRST — above the header and everything else — because an
          available update is meta-app: it's about Tide itself, not about
          anything Deepak is trying to do today. Same placement reasoning as
          Runway's own Home.tsx update card. */}
      {showUpdateCard && availableUpdate && (
        <div className="flex flex-col gap-3 rounded-xl border border-sky-800/60 bg-sky-950/30 p-4">
          <div>
            <p className="font-medium text-slate-100">Update available: v{availableUpdate.version}.</p>
            <p className="text-sm text-slate-400">You have v{APP_VERSION}.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => downloadUpdate(availableUpdate.version)} className="flex-1">
              Download
            </Button>
            <TextAction onClick={() => dismissUpdateCard(availableUpdate.versionCode)}>Not now</TextAction>
          </div>
        </div>
      )}

      <header className="pt-12 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.15em] text-slate-500">Tide</p>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        {trend ? (
          <>
            <p className="text-huge font-semibold tracking-tight tabular-nums text-slate-100">
              {trend.smoothedKg.toFixed(1)}
              <span className="text-2xl font-medium text-slate-500"> kg</span>
            </p>
            <p className="text-slate-400">{formatTrendLine(trend)}</p>
          </>
        ) : weighIns.length === 0 ? (
          <p className="max-w-xs text-slate-400">Add your first weigh-in to start the trend.</p>
        ) : (
          // Below the evidence floor (MIN_POINTS) but not empty — an
          // honest "not yet" rather than a fabricated trend line built
          // from too little data. See trend.ts's MIN_POINTS doc comment.
          <p className="max-w-xs text-slate-400">
            {MIN_POINTS - weighIns.length} more weigh-in{MIN_POINTS - weighIns.length === 1 ? '' : 's'} to a trend.
          </p>
        )}
        {/* Health Connect bridge increment (0.3.0): both lines below are
            quiet, secondary, and simply absent when there's nothing to
            show — no "N more readings" placeholder the way the weight
            trend's own evidence-floor state gets one, since neither a
            missing body-fat reading nor a missing watch sync is something
            Deepak is necessarily doing anything about (unlike weigh-ins,
            which are the one input this whole screen asks him to supply). */}
        {bfTrend && <p className="text-sm text-slate-500">{formatBodyFatTrendLine(bfTrend)}</p>}
        {movementLine && <p className="text-sm text-slate-500">{movementLine}</p>}
      </section>

      <section className="flex flex-col items-center gap-4">
        <Button onClick={() => onNavigate({ name: 'weighInEntry' })} className="w-full max-w-xs">
          Add weigh-in
        </Button>
        <div className="flex gap-6">
          <TextAction onClick={() => onNavigate({ name: 'history' })}>History</TextAction>
          <TextAction onClick={() => onNavigate({ name: 'settings' })}>Settings</TextAction>
        </div>
      </section>
    </div>
  );
}
