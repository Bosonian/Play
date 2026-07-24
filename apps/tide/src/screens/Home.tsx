import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { TextAction } from '../ui/TextAction';
import { bodyFatTrend, currentTrend, formatBodyFatTrendLine, formatTrendLine, MIN_POINTS } from '../lib/trend';
import {
  dailyShapeProgress,
  formatCheckInsLine,
  formatDailyShapeMetLine,
  formatStepsLine,
  parseDailyShapeTarget,
} from '../lib/dailyShape';
import { DAILY_SHAPE_TARGET_SETTING } from '../lib/dailyShapeSettings';
import { APP_VERSION, APP_VERSION_CODE } from '../lib/appVersion';
import { AVAILABLE_UPDATE_SETTING, parseAvailableUpdate } from '../lib/updateCheck';
import { logEvent } from '../lib/eventLog';
import { formatMovementLine, localDateKey, localDayBoundsIso } from '../lib/healthSync';

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

  // Plate check-in increment (0.4.0): today's check-in count, for the quiet
  // shortcut line below — a `count()` query, not a full row fetch, since
  // this screen only ever needs the number (the actual rows live on
  // PlatesToday.tsx). Counts every check-in including skips (the line below
  // reads "check-ins", never "plates" — see its own comment), so the number
  // always matches the list a tap navigates to. Same device-local day
  // boundary as PlatesToday.tsx's own query (localDayBoundsIso,
  // healthSync.ts) — the two screens must agree on what "today" means or the
  // count here could disagree with the list a tap on it navigates to.
  const todayMealCount = useLiveQuery(async () => {
    const { startIso, endIso } = localDayBoundsIso();
    return db.meals.where('at').between(startIso, endIso, true, false).count();
  }, []);

  // Daily shape increment (increment 7, TIDE_PLAN.md §5's signal 5): the
  // target itself lives in one settings row (dailyShapeSettings.ts),
  // read reactively the same way the Health Connect flags above are — a
  // change from Settings' Save/Remove should reach Home the instant Dexie
  // commits it, no separate "refresh" step. `parseDailyShapeTarget` (not
  // `readDailyShapeTarget`) is used directly here because it's synchronous
  // and this component already has the raw row from `useLiveQuery` — no
  // reason to await a second Dexie round trip for a value already in hand.
  const dailyShapeSetting = useLiveQuery(() => db.settings.get(DAILY_SHAPE_TARGET_SETTING), []);
  const dailyShapeTarget = parseDailyShapeTarget(dailyShapeSetting?.value);

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

  // Daily shape's own progress, computed only once a target actually exists
  // (dailyShapeProgress needs a real DailyShapeTarget, not null) — see
  // dailyShape.ts for the actuals' own null-handling contract. `steps: null`
  // when `todayMovement` hasn't resolved/synced yet (never a bare 0 — see
  // formatMovementLine's identical rule just above); `checkIns` defaults to
  // 0 while `todayMealCount`'s own query is still resolving, the same brief
  // window `weighIns === undefined` covers for the trend above — the count
  // corrects itself the instant that query resolves, via the same
  // `useLiveQuery` re-render.
  const dailyShape = dailyShapeTarget
    ? dailyShapeProgress(dailyShapeTarget, { checkIns: todayMealCount ?? 0, steps: todayMovement?.steps ?? null })
    : null;
  const dailyShapeCheckInsLine = dailyShape ? formatCheckInsLine(dailyShape.checkIns) : null;
  const dailyShapeStepsLine = dailyShape ? formatStepsLine(dailyShape.steps) : null;

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
        {/* Plate check-in increment (0.4.0): a quiet shortcut, not a
            headline — present only once there's something to jump to
            (>=1 check-in today), same "absent when there's nothing to show"
            treatment as bfTrend/movementLine just above. A plain <button>
            rather than TextAction: TextAction's own slate-400 is tuned for
            footer-weight actions, one shade lighter than the slate-500 the
            other secondary lines on this screen use, and matching THOSE is
            what keeps this line reading as "one more quiet fact", not a
            call to action competing with the trend headline above it.

            "check-in", NOT "plate" (review fix, 0.4.1): the count includes
            skipped meals (PlatesToday lists them, so the count that links
            there must match, or a tap on "2" would open a list of 3). A
            skip is a real check-in but NOT a plate — calling it a "plate"
            here would tell Deepak he ate when he didn't, the exact
            skip-as-a-meal reframe TIDE_PLAN.md §2 forbids. "check-in" is
            honest for both, and is the plan's own word ("3 honest
            check-ins").

            Hidden once the daily-shape block below is showing (increment
            7): that block's own check-ins line already states this exact
            number, and showing it twice on one screen would be noise, not
            scaffolding — kept for a day with no target set, where it's the
            only such line on the screen. */}
        {!dailyShapeTarget && todayMealCount !== undefined && todayMealCount > 0 && (
          <button
            type="button"
            onClick={() => onNavigate({ name: 'platesToday' })}
            // min-h-12 + inline-flex/items-center (polish pass, increment
            // 6): this was the only interactive element on the whole app
            // below the 48px touch-target floor every other control
            // (Button, TextAction, Card, TextField) already meets. Padding
            // and inline-flex only, deliberately NOT a background/border —
            // the quiet slate-500 "one more fact" look this button's own
            // original comment describes stays exactly as quiet; only the
            // tappable area grows.
            className="inline-flex min-h-12 items-center px-2 text-sm text-slate-500 transition-colors hover:text-slate-300"
          >
            {todayMealCount} check-in{todayMealCount === 1 ? '' : 's'} today
          </button>
        )}
      </section>

      {/* Daily shape (increment 7, TIDE_PLAN.md §5's signal 5) — a
          subordinate, own-card block, deliberately BELOW the trend section
          above and ABOVE the action buttons below, never touching the
          headline itself. CRITICAL, per this increment's own instructions:
          unlike Runway's dailyShape.ts (todayLine), which swaps
          ExamOverview's headline once a target is set, Tide's trend
          headline above never changes shape because of this block — §5
          ranks daily shape strictly below the weight/body-fat trends, and
          letting a to-do list displace the north star would quietly violate
          that ranking. Absent entirely with no target set (dailyShape is
          `null` in that case) — no "set a target" nag card, matching
          bfTrend/movementLine's own "absent when there's nothing to show"
          idiom just above, rather than an empty-state advertisement for a
          feature CLAUDE.md's defaults-lean-smaller rule says should stay
          opt-in and quiet. */}
      {dailyShape && (
        <button
          type="button"
          onClick={() => onNavigate({ name: 'platesToday' })}
          // Met: a quiet emerald accent (border + text) — same accent color
          // Runway's own dailyShape rendering uses for its met state
          // (ExamOverview.tsx), reused here for visual consistency across
          // the two sibling apps' identical "day-sized target met" idea.
          // Unmet: entirely neutral slate, matching every other quiet card
          // on this screen — no red/amber, no progress bar, no "keep
          // going": CLAUDE.md's no-shame rule applies exactly as much to an
          // UNMET day as an emoji would to a met one.
          className={`min-h-12 w-full rounded-xl border p-4 text-left transition-colors ${
            dailyShape.met
              ? 'border-emerald-800/60 bg-emerald-950/20 hover:bg-emerald-950/30'
              : 'border-slate-800/60 bg-surface hover:bg-raised/70'
          }`}
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
            Today&apos;s shape
          </p>
          <div className="mt-1.5 flex flex-col gap-0.5">
            {dailyShapeCheckInsLine && (
              <p className={`text-sm ${dailyShape.met ? 'text-emerald-300' : 'text-slate-300'}`}>
                {dailyShapeCheckInsLine}
              </p>
            )}
            {dailyShapeStepsLine && (
              <p className={`text-sm ${dailyShape.met ? 'text-emerald-300' : 'text-slate-300'}`}>
                {dailyShapeStepsLine}
              </p>
            )}
          </div>
          {/* The overall line only on the met side — an unmet day gets no
              equivalent "not met" sentence at all (the plain numbers above
              already say so; a second sentence stating it again would tip
              toward the score-keeping tone CLAUDE.md rules out). */}
          {dailyShape.met && (
            <p className="mt-1.5 text-sm font-medium text-emerald-300">{formatDailyShapeMetLine()}</p>
          )}
        </button>
      )}

      <section className="flex flex-col items-center gap-4">
        <Button onClick={() => onNavigate({ name: 'weighInEntry' })} className="w-full max-w-xs">
          Add weigh-in
        </Button>
        {/* Secondary, directly beneath the primary action — deliberately
            NOT another primary Button: TIDE_PLAN.md §2's north star is the
            weight trend, and "Add weigh-in" is the one action this screen
            should read as urging. "Add plate" needs to be reachable in one
            tap, not equally emphasised. */}
        <Button
          variant="secondary"
          onClick={() => onNavigate({ name: 'plateCheckIn' })}
          className="w-full max-w-xs"
        >
          Add plate
        </Button>
        <div className="flex gap-6">
          <TextAction onClick={() => onNavigate({ name: 'history' })}>History</TextAction>
          {/* Always present, regardless of todayMealCount — the count-line
              shortcut above only exists once there's a plate to show, so
              this is the one guaranteed path to PlatesToday on a day with
              nothing logged yet. */}
          <TextAction onClick={() => onNavigate({ name: 'platesToday' })}>Plates</TextAction>
          <TextAction onClick={() => onNavigate({ name: 'settings' })}>Settings</TextAction>
        </div>
      </section>
    </div>
  );
}
