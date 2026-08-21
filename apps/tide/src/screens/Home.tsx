import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { TextAction } from '../ui/TextAction';
import { TrendChart } from '../ui/TrendChart';
import {
  bodyFatTrend,
  currentTrend,
  formatBodyFatTrendLine,
  formatLastWeighInLine,
  formatTrendLine,
  MIN_POINTS,
} from '../lib/trend';
import {
  dailyShapeProgress,
  formatCheckInsLine,
  formatDailyShapeMetLine,
  formatStepsLine,
  parseDailyShapeTarget,
} from '../lib/dailyShape';
import { DAILY_SHAPE_TARGET_SETTING } from '../lib/dailyShapeSettings';
import { HEALTH_CONNECT_ENABLED_SETTING } from '../lib/healthSettings';
import { dismissSetupPrompt, SETUP_PROMPT_DISMISSED_SETTING, shouldShowSetupPrompt } from '../lib/setupPrompt';
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
  //
  // Sentinel pattern (`.then((row) => row ?? null)`, review fix 0.11.1) —
  // see the setup-prompt block below for the full rationale. `?.value`
  // below treats `undefined` (loading) and `null` (genuinely absent) the
  // same way `parseDailyShapeTarget` already did before this fix (both
  // become `undefined`, which it maps to `null`), so this line's own
  // behaviour is unchanged; the setup-prompt block is what needed the two
  // states told apart, and it reads this same query result to get them.
  const dailyShapeSetting = useLiveQuery(
    () => db.settings.get(DAILY_SHAPE_TARGET_SETTING).then((row) => row ?? null),
    [],
  );
  const dailyShapeTarget = parseDailyShapeTarget(dailyShapeSetting?.value);

  // Setup prompt increment (increment 11, TIDE_PLAN.md's "ask before adding
  // features" boundary respected — this is the smallest honest nudge, not
  // an onboarding flow): reads the same settings rows Settings.tsx itself
  // reads (HEALTH_CONNECT_ENABLED_SETTING and DAILY_SHAPE_TARGET_SETTING)
  // plus its own durable dismissal flag.
  //
  // SENTINEL PATTERN (review fix, 0.11.1) — `.then((row) => row ?? null)`
  // turns Dexie's own two-state read (`undefined` while loading, the row
  // once it resolves — `undefined` again if there IS no row) into three
  // states useLiveQuery can actually distinguish: `undefined` = this
  // query's first read hasn't resolved yet; `null` = it resolved and there
  // is genuinely no row (the feature was never touched); a real row =
  // resolved AND present, whatever its value. That third state matters
  // because `handleDisconnect` writes HEALTH_CONNECT_ENABLED_SETTING =
  // 'false' and `clearDailyShapeTarget` writes DAILY_SHAPE_TARGET_SETTING =
  // '' — present-but-declining rows, not deleted ones (see both functions'
  // own comments) — and this card must tell "never offered" (missing, nudge
  // again) apart from "offered and explicitly declined" (not missing, stop
  // nagging). The PREVIOUS version of this comment claimed `undefined`
  // "correctly falls on the missing side" of the check below — true for the
  // genuinely-never-set case, but wrong for the not-yet-loaded case, where
  // it just meant "we don't know yet" and got treated as "missing" anyway.
  const healthConnectSetting = useLiveQuery(
    () => db.settings.get(HEALTH_CONNECT_ENABLED_SETTING).then((row) => row ?? null),
    [],
  );
  // Missing = the row was never written at all. A row present with 'false'
  // means Health Connect was connected once and explicitly disconnected —
  // re-showing "Connect health data" for that is exactly the nag CLAUDE.md
  // forbids, since Deepak never got a live card to dismiss while he was
  // using the feature (the card only renders when something IS missing).
  const healthConnectMissing = healthConnectSetting === null;
  // Missing = the row was never written at all. A row present with ''
  // means a daily-shape target was set once and explicitly removed
  // (`handleRemoveDailyShape` in Settings.tsx) — same "explicitly declined,
  // not missing" reasoning as Health Connect above. `dailyShapeTarget`
  // itself (computed above from the same row, for the block further down)
  // can't be reused for this check: `parseDailyShapeTarget` returns `null`
  // for BOTH "row absent" and "row present but ''", collapsing exactly the
  // distinction this check needs.
  const dailyShapeMissing = dailyShapeSetting === null;
  const setupPromptDismissedSetting = useLiveQuery(
    () => db.settings.get(SETUP_PROMPT_DISMISSED_SETTING).then((row) => row ?? null),
    [],
  );
  // Cold-start flash fix (review fix, 0.11.1): these three queries resolve
  // independently of each other and of `weighIns` above, each triggering
  // its own re-render as it settles. Without this gate, a fully set-up (or
  // already-dismissed) device could render the card for one frame using
  // whichever settings happened to still read `undefined` — which, before
  // this fix, was treated the same as "missing" — before the rest caught
  // up. Requiring all three to be resolved first means the card's very
  // first paint already reflects the real, settled state.
  const setupSettingsLoaded =
    healthConnectSetting !== undefined &&
    dailyShapeSetting !== undefined &&
    setupPromptDismissedSetting !== undefined;
  const showSetupPrompt =
    setupSettingsLoaded &&
    shouldShowSetupPrompt({ healthConnectMissing, dailyShapeMissing }, setupPromptDismissedSetting?.value === 'true');

  async function handleDismissSetupPrompt() {
    await dismissSetupPrompt();
    void logEvent('setup', 'Setup prompt dismissed.');
  }

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

  // The latest ACTUAL weigh-in (increment 11) — `weighIns` arrives sorted
  // ascending by `at` (see the `useLiveQuery` call above), so the last
  // element is the most recent one, evidence-floor or not. `null` only for
  // a genuinely empty table — this line is deliberately independent of
  // `trend`'s own MIN_POINTS floor (unlike the hero number, a single real
  // reading is exactly as reconcilable as twenty), and it needs to keep
  // showing in the "N more weigh-ins to a trend" state below the floor,
  // where it's most useful (see this increment's own brief).
  const latestWeighIn = weighIns.length > 0 ? weighIns[weighIns.length - 1] : null;

  return (
    // gap-6 — increment 9's page-rhythm scale (see the other screens'
    // identical outer container): this was gap-8 previously, the one page
    // whose top-level rhythm didn't match every other screen's.
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
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
            {/* Label (increment 11): the hero number is the EMA-smoothed
                trend, not today's scale reading — see trend.ts's EMA_ALPHA
                comment for why those two can differ by close to a kilo.
                Unlabelled, that gap reads as a bug to a reader this exact;
                this micro-label is the smallest fix that doesn't restructure
                the headline itself. Same micro-label treatment as every
                other uppercase heading in this app
                (text-[11px]/tracking-[0.15em]/text-slate-500).

                "Smoothed weight", NOT "Smoothed trend" (review fix, 0.11.1):
                `formatTrendLine` one line below already prints "Trend: …
                kg/week" for the SLOPE — a different quantity (a rate) from
                this LEVEL (a kg figure). Reusing "trend" for both, one line
                apart, told the reader they were the same thing. Also
                deliberately NOT "21-day smoothed weight" — TREND_WINDOW_DAYS
                (trend.ts) bounds only the slope fit below; the EMA level
                itself has no fixed window at all (its effective memory is
                roughly 1/EMA_ALPHA, about 10 readings — see EMA_ALPHA's own
                doc comment). A day count on this label would sound precise
                and describe the wrong mechanism. */}
            <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Smoothed weight</p>
            <p className="text-huge font-semibold tracking-tight tabular-nums text-slate-100">
              {trend.smoothedKg.toFixed(1)}
              {/* kg unit: smaller, lighter weight, one shade dimmer than
                  the number it qualifies — reads as a unit label riding
                  alongside the number, not as a second number of equal
                  weight competing with it (increment 9 typography pass). */}
              <span className="ml-1 align-baseline text-2xl font-medium text-slate-500">kg</span>
            </p>
            <p className="text-slate-400">{formatTrendLine(trend)}</p>
            {/* The trend chart — TIDE_PLAN.md §5.1's "smoothed line," drawn
                (increment 9). Belongs to the headline above it, not a
                separate block: no card, no border, same max-w-xs column as
                the empty-state sentences this section already centres, so
                it reads as part of the north star's own vertical rhythm
                rather than a second thing competing for attention. */}
            <div className="mt-1 w-full max-w-xs">
              <TrendChart weighIns={weighIns} />
            </div>
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
        {/* Last-actual-weigh-in reconciliation line (increment 11) — see
            trend.ts's own header comment on `formatLastWeighInLine`
            (renamed from `formatLastReadingLine`, review fix 0.11.1 — see
            that function's own doc comment for why "reading" was the wrong
            noun here). Placed directly below the trend/no-trend block above
            and above the bfTrend/movementLine lines: it's the one line that
            explains BOTH of the states above it (why the hero number
            doesn't match the scale; and, below the evidence floor, what the
            scale actually said while there's no trend yet to show at all) —
            the brief's own instruction that it "should still appear" in
            that second case is exactly why this isn't nested inside the
            `trend &&` branch above. */}
        {latestWeighIn && <p className="text-sm tabular-nums text-slate-500">{formatLastWeighInLine(latestWeighIn)}</p>}
        {/* Health Connect bridge increment (0.3.0): both lines below are
            quiet, secondary, and simply absent when there's nothing to
            show — no "N more readings" placeholder the way the weight
            trend's own evidence-floor state gets one, since neither a
            missing body-fat reading nor a missing watch sync is something
            Deepak is necessarily doing anything about (unlike weigh-ins,
            which are the one input this whole screen asks him to supply). */}
        {bfTrend && <p className="text-sm tabular-nums text-slate-500">{formatBodyFatTrendLine(bfTrend)}</p>}
        {movementLine && <p className="text-sm tabular-nums text-slate-500">{movementLine}</p>}
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
        {/* Hidden only when the block ACTUALLY renders a check-ins line
            (review fix, 0.8.0). The condition was `!dailyShapeTarget`, whose
            justification above — "that block's own check-ins line already
            states this number" — is false for a steps-only shape
            (checkIns: 0), where formatCheckInsLine returns null and the
            block shows no check-in count at all. The result was that setting
            a steps-only target silently removed the check-in count from
            Home entirely: a line that existed before this feature, gone for
            no reason the user could see. */}
        {!(dailyShapeTarget && dailyShapeTarget.checkIns > 0) &&
          todayMealCount !== undefined &&
          todayMealCount > 0 && (
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
            className="inline-flex min-h-12 items-center px-2 text-sm tabular-nums text-slate-500 transition-colors hover:text-slate-300"
          >
            {todayMealCount} check-in{todayMealCount === 1 ? '' : 's'} today
          </button>
        )}
      </section>

      {/* Setup prompt (increment 11) — placed BELOW the trend section, not
          above it: the north star still leads on a fresh install exactly as
          it does on every other one, and a nudge about incomplete setup is
          meta-app in the same way the update card is, just lower-urgency
          (nothing is broken; two optional features are simply unconnected)
          — ABOVE the update card's placement, not below the Add-weigh-in
          action, so it's still seen before the primary action rather than
          competing with it or trailing after it where it would read as an
          afterthought. Placed above the daily-shape block, not below: if
          the daily-shape target IS the missing step, this card and that
          block would otherwise sit in the same visual slot with nothing
          between them to show they're related. Renders nothing at all once
          both steps are done or the card has been dismissed
          (shouldShowSetupPrompt, setupPrompt.ts) — no permanent settings
          shortcut left behind here; Settings itself remains the durable
          path to both features, same "absent when there's nothing to show"
          idiom as bfTrend/movementLine above. */}
      {showSetupPrompt && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
          <div className="flex flex-col">
            {healthConnectMissing && (
              <button
                type="button"
                onClick={() => onNavigate({ name: 'settings', scrollTo: 'healthConnect' })}
                className="flex min-h-12 items-center text-left text-sm text-slate-300 transition-colors hover:text-slate-100"
              >
                {/* NOT "arrive on their own" (review fix, 0.11.1) — that
                    read as background push. The truth: Tide reads Health
                    Connect at app open/resume and on manual sync, and a
                    weigh-in only shows up here at all if the Renpho ->
                    Samsung Health -> Health Connect chain is set up
                    upstream (see this screen's Health Connect section in
                    Settings.tsx for that chain spelled out in full). */}
                Connect health data — weigh-ins and steps read in from your scale and watch.
              </button>
            )}
            {dailyShapeMissing && (
              <button
                type="button"
                onClick={() => onNavigate({ name: 'settings', scrollTo: 'dailyShape' })}
                className="flex min-h-12 items-center text-left text-sm text-slate-300 transition-colors hover:text-slate-100"
              >
                {/* NOT "on this screen" (review fix, 0.11.1) — wrong twice
                    over: the tap navigates OFF Home to Settings, and the
                    target isn't rendered here until AFTER it's set (see the
                    daily-shape block below, `dailyShape &&`). "Shown here
                    once set" is the honest version of the same pointer. */}
                Set a daily shape — a day-sized target, shown here once set.
              </button>
            )}
          </div>
          <TextAction onClick={() => void handleDismissSetupPrompt()} className="self-start">
            Dismiss
          </TextAction>
        </div>
      )}

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
              <p className={`text-sm tabular-nums ${dailyShape.met ? 'text-emerald-300' : 'text-slate-300'}`}>
                {dailyShapeCheckInsLine}
              </p>
            )}
            {dailyShapeStepsLine && (
              <p className={`text-sm tabular-nums ${dailyShape.met ? 'text-emerald-300' : 'text-slate-300'}`}>
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
