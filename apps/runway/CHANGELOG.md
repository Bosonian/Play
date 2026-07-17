# Runway changelog

Versions map to `versionName` in `android/app/build.gradle`. Install always
via the `runway-latest.apk` asset at
https://github.com/Bosonian/Play/releases/tag/runway-latest — it carries
whichever version built last.

## 0.41.2
- **Two fixes from one report.** Field report #14, verbatim: "Accidental touch caused earlier input that departure called punctual to work finished. And it can't be edited and continued from history now." The same misfire TaskRun.tsx already had a fix for (0.34.1's Reopen) had no equivalent on the departure side: checking a departure's LAST arrival step auto-resolves it to 'done' with no confirmation, and until now there was no way back from there. While tracking this down, a second bug turned up: the report itself arrived on GitHub as two identical issues (#14 and #15, same timestamp) — the log's own sync racing itself.
  - **`src/lib/strandedArrival.ts`**: new `lastCheckedArrivalStepId(departure)` — the arrival-phase twin of `taskProjection.ts`'s `lastCheckedUnitId`, mirrored rather than shared because that function is typed against `WorkTask['units']` and this one against `Departure['arrivalSteps']`. Same lexicographic-max-is-chronological-max logic (ISO 8601 strings sort correctly as plain strings), same first-encountered tiebreak on a timestamp collision, `null` for an empty/legacy-undefined list or nothing checked. 5 new tests.
  - **`src/screens/Runway.tsx`**: the terminal ('left'/'done'/'abandoned') view gains a "Reopen — undo the last check-off." `TextAction`, gated on `departure.status === 'done'` AND `lastCheckedArrivalStepId(departure) !== null` — that predicate alone also correctly excludes a `'done'` departure with NO arrival steps at all (Home's Early/On time/Late buttons resolved that one, an explicit chosen confirmation, not a stray touch — same reasoning TaskRun.tsx's own abandoned-state branch gives for withholding Reopen there) and `'abandoned'` (its own explicit action). The handler is one transactional `.modify()`: unchecks that last arrival step, `status` back to `'left'`, clears `arrivalResult`/`arrivalLateMinutes` (they described a completion that no longer stands once its last check-off is undone). Deliberately does NOT touch `arrivedAt` (the building arrival was real and separately recorded — `handleArrived`'s own explicit tap) or `leftAt` (the door was still walked through at that moment). `refreshWidgets`/`refreshDayGauge`/`logEvent('departure', "Departure reopened: {name}.")` follow, same shape as every other write on this screen. Landing on `'left'` with arrival steps still present is what makes the `arrivalPhaseActive` branch (checked ahead of this one, at the top of the component) render the live arrival checklist again on the very next tick — no separate "which screen now" logic needed — and it's also exactly what `strandedInArrival` (`strandedArrival.ts`) reads, so Home's "Waiting on arrival" card comes back for this departure too. Verified by reading, not assumed: both checks hold.
  - **`src/screens/History.tsx`**: departure rows for `'left'` and for `'done'` with a checked arrival step (the exact same `lastCheckedArrivalStepId` predicate Runway.tsx's own Reopen action gates on, reused here rather than a second copy) are now tappable `Card`s → `onNavigate({ name: 'runway', departureId })`, landing on the terminal view where Reopen now lives (or, for a `'left'` row with no arrival steps, the plain "finished" note — never a broken destination either way). Only an arrival-stepless `'done'` departure keeps the old plain, non-tappable div — a completion confirmed through Home's explicit buttons, with no checklist and therefore no reopen destination to land on. The 0.34.1-era "no reopen destination" comment on this block is updated to state that narrower truth.
  - **`src/lib/reportSync.ts`**: `syncPendingReports` gains a module-level single-flight guard (`inFlightSync`) — a call that arrives while a drain is already running now awaits the SAME promise instead of starting a second, parallel one. Root cause of the #14/#15 duplicate: the drain reads every `'pending'` row before it writes `'synced'` back onto any of them, so two overlapping calls (Save's fire-and-forget racing an app-open call, or a Retry tap landing mid-drain) each independently read the same still-pending report and each filed it as its own issue. The guard is a mutex, not a queue: a call arriving AFTER the in-flight drain finished starts a genuinely fresh one, and no re-run is queued for a report saved mid-drain — every real call site (Save, Retry, app open) already re-invokes this on its own trigger. The drain body itself is unchanged, split into a private `runSyncPendingReports` so the exported function's own body stays just the mutex. 3 new tests (mocked `db`/`readReportConfig`/`logEvent`, following `eventLog.test.ts`'s precedent): a second concurrent call doesn't re-read config; a call after completion starts fresh; the guard clears even after an unexpected internal error.
  - 627 tests total, up from 619 (5 + 3 above).
  - `npm run typecheck && npm run test && npm run build` all pass from `apps/runway`. No native code touched — `npx cap sync android` skipped.
  - `versionCode 58` / `versionName "0.41.2"`.

## 0.41.1
- **The headline swap: "even after edit it didn't change".** The user's own follow-up on 0.41.0, verbatim — after that release shipped the daily sprint target, it landed as small grey text under the weekly bar while the giant red "Ready by 10 Jan 2028" kept leading the screen. The line existed. The big number Deepak's ADHD brain locks onto and stalls on was still the exam-scale one, not the day-scale one — the exact big-number paralysis 0.41.0 set out to fix, unfixed by its own placement choice. This release doesn't add a new fact; it changes which existing fact gets the giant, bold, first-thing-you-see treatment. **When a daily target is set, the day-sized number becomes the headline and the ready-by projection compresses into one calm line underneath it. The projection stays exactly as honest as before — same numbers, same colours, just turned down in volume. When no daily target is set, nothing changes anywhere.**
  - **`src/screens/ExamOverview.tsx`**: new `dailyHeadline` (`daily` from `todayLine`, forced `null` when `projection.state === 'done'`) decides the centerpiece. With a live `dailyHeadline`: the `text-huge font-bold tracking-tight tabular-nums` treatment — the exact classes "Ready by ..." used — now wraps `dailyHeadline.text` instead. Colour: met → `text-emerald-300` (the app's one acknowledgment accent); not met → `text-slate-100` (plain, not a warning — a daily target is a floor to reach, not a deadline to miss, so red/amber would misrepresent it); `'Rest day.'` → `text-slate-400` (unconditionally `met: true` in `dailyShape.ts`, but not an achievement to celebrate the way a real met target is, so it stays plain rather than borrowing emerald). Directly under the exam anchor line, a new compressed projection line takes over the old headline's informational role: `Ready by {date} · {n} days of margin` (or "past the exam"), on the exact same `formatDateMedium`/`formatExamMarginLine` calls and the exact same `textAccent` state colour (red-400 late, amber-400 tight, slate-100 calm) the old headline + margin line used — recomposed, not reinvented. **Judgment call, flagged per the brief**: the zero-pace "Never" case has no margin figure to combine with a date (there's no date), so it keeps its original two-line shape ("Never" + the pace-assumption sentence) rather than forcing an awkward single line; both lines are simply resized to match the other anchor-area text instead of collapsing to one. The old 0.41.0 Today line under the weekly bar is removed for calm/tight/late (it's the headline now) but **kept, unchanged, for `'done'`** — `'done'` is deliberately excluded from the headline swap (finishing every topic's estimate already gets its own emerald acknowledgment line, "All topics at their estimated hours.", and isn't a day the sprint count should visually outrank), so without this exception a `dailyTarget` set on a finished exam would lose its Today count entirely. `'empty'` needed no equivalent carve-out: the whole tactical section (and `daily` with it) is already gated off in that state, before or after this change.
  - **`src/lib/widgetSnapshot.ts`**: `PruefungWidgetData` gains a prebaked `headlineMode: 'today' | 'ready'` (`daily ? 'today' : 'ready'`) — the increment brief's own instruction, since the actual mode toggle lives in Java visibility calls and needed a TS-side field to stay unit-testable. Unlike ExamOverview.tsx's `dailyHeadline`, this carries no `'done'`-state exclusion: the widget has never had a distinct `'done'` rendering to preserve (`examProjection`'s `'done'` state just flows through the ordinary ready-date/colour-band path on the native side), so there's nothing to carve out. The native side does NOT trust this field blindly — see below.
  - **`PruefungWidgetProvider.java` + `widget_pruefung.xml`**: 0.41.0's `applyTodayLine` (one row, one job) is replaced by `applyHeadline` (two fixed-position slots, content moves between them). RemoteViews has no view-reordering primitive, so "the day-sized number leads" can't be built by moving a view up the layout the way the live screen's JSX can render a different element first — the idiom instead is two ALREADY-existing views (`widget_line1`, 18sp bold; the repurposed `widget_line_today`, 12sp) that both always exist, with `setTextViewText`/`setTextColor`/`setViewVisibility` deciding per-render which fact occupies which slot. With a live, fresh `todayLine`: `widget_line1` = the Today text (met → `#6EE7B7` emerald; else → `#F1F5F9`, matching `widget_line1`'s own existing calm-state neutral — no separate rest-day tint on the widget, a narrower palette than the live screen's three-way split, flagged as a deliberate simplification rather than an oversight, since the snapshot's `todayMet` boolean alone can't distinguish a rest day from an ordinary met day without a new field nothing else needed); `widget_line_today` = whatever `widget_line1` would otherwise have shown (the ready-by/never/no-topics text, unchanged wording and colour logic), at its own existing 12sp size. With no `todayLine`, or a STALE one: `widget_line1` renders exactly as pre-0.41.1, `widget_line_today` stays hidden. **The one-day staleness guard is the more important half of this change, not a lesser one**: 0.41.0 already refused to show yesterday's sprint count in the old 12sp row; that guard now gates the HEADLINE too, because a bold, wrong "Today: 3 of 3 sprints." would be a much louder version of the same lie a small stale line already was — a stale snapshot falls back to ready-by-as-headline, never a big wrong number. `widget_line_today` keeps its 0.41.0 id (renaming it would touch two files for a cosmetic gain only; the layout's own comment is now the source of truth for its dual purpose). `COLOR_TODAY_DEFAULT` (0.41.0's dedicated not-met slate-400) is removed as dead code — the headline's not-met colour is `COLOR_CALM`, the same constant `widget_line1` already used for its own neutral state.
  - 3 new tests (`widgetSnapshot.test.ts`): `headlineMode` is `'ready'` with no `dailyTarget`; `'today'` once a `dailyTarget` produces a `todayLine`; and `'today'` on a configured rest day too (a rest day still has a `todayLine` to headline). 619 tests total, up from 616.
  - `npm run typecheck && npm run test && npm run build` all pass from `apps/runway`. `npx cap sync android` ran clean, no new npm dependency. Android's Gradle build could not be run from this environment (no Android SDK/JDK toolchain here) — CI's Gradle job is the real verification for the Java/XML-side changes here, same caveat every widget increment in this changelog already carries.
  - `versionCode 57` / `versionName "0.41.1"`.

## 0.41.0
- **A day-sized floor beside the honest weekly number.** The user's own framing, verbatim: "Three 50-min sprints daily, one full rest day: 2.5 h × 6 = 15 h. you know my adhd brain sees the big numbers and dont even start." The exam overview leads with strategy-sized numbers — a 310 h total, an 18.7 h/week required pace, a red ready-by date — every one of them correct, and every one of them paralyzing to look at with zero data logged. This release adds the day-sized actionable unit underneath them: an optional daily sprint target with a rest day, surfaced as **"Today: 1 of 3 sprints."** on the exam overview, the post-sprint screen, and the Prüfung widget.
  - **The decoupling decision, stated plainly because it's the whole point of this increment**: 3 sprints × 50 min × 6 days (one rest day) is 15 h/week — genuinely, honestly LESS than an 18.7 h/week requirement would be. `Exam.dailyTarget` (`src/db/types.ts`, new `DailyTarget` type: `{ sprints: 1-4, restDay: ISO weekday | null }`) feeds NO projection — `examProjection.ts` never reads it, `measuredPaceHoursPerWeek`/`requiredPaceHoursPerWeek` are entirely untouched, and the ready-by headline and required-pace line render exactly as honestly as they did in 0.40.1. A daily counter that quietly implied "you're on pace" the moment it turned green would be exactly the kind of reassuring-but-false number CLAUDE.md's "tell the truth about tradeoffs" rule forbids. `src/lib/dailyShape.ts`'s `todayLine` only ever reads sprint-COMPLETION counts, never hours, so there's no code path by which this field could launder itself into the pace math even by accident. Non-indexed, undefined-as-null, no Dexie version bump — same treatment `studySchedule` already gets.
  - **`src/lib/dailyShape.ts`** (new): `isoWeekday(date)` (thin, testable wrapper around date-fns's `getISODay` — `recurrence.ts` calls it inline with no name of its own, so this is the first call site that wanted one). `sprintsCompletedOn(date, sprints)` counts sprints whose `endedAt` falls on `date`'s LOCAL calendar day, ANY length — counting a start is the psychology this increment is built around; measuring duration stays `examProjection.ts`'s job. `todayLine(now, dailyTarget, sprints)` returns `null` with no target set, `{ text: 'Rest day.', met: true }` on the configured rest day, otherwise `{ text: 'Today: N of target sprints.', met: n >= target }` with `n` never capped past the target — "4 of 3" shows honestly, never silently clamped to "3 of 3" (CLAUDE.md's "exact, not approximate" copy rule, applied to a number). 15 new tests (`dailyShape.test.ts`).
  - **`src/screens/ExamSetup.tsx`**: a new "Daily shape" section under Study blocks — 1/2/3/4 sprint-count chips (same chip idiom as the study-block length picker) and a single-select rest-day picker (the RepeatEditor day-chip look, rebuilt locally rather than reusing that component, since its `days`/`onToggleDay` props are shaped for MULTI-select and a rest day is single-select). No separate enable checkbox: leaving every chip deselected IS the off state (`dailyTarget: null` on save), and tapping the selected sprint-count or rest-day chip again deselects it — a judgment call beyond the literal spec, flagged here rather than silently added. Caption, exact: *"A day-sized target: sprints today, nothing bigger. It changes no projection — the ready date stays honest above it."* No alarms involved — Study blocks' `ensurePermissions`/`scheduleStudyBlockAlarms` pairing has no equivalent here.
  - **`src/screens/ExamOverview.tsx`**: the Today line lands directly UNDER the weekly progress bar — after the bar, before "Best week: N h." — never above the "Ready by ..." headline. The truth (ready date, margin line, required-pace line) stays the centerpiece; the actionable day-sized line sits with the other tactical surfaces (the bar, "This week: ...", the study-blocks schedule) below it. `text-slate-400`/`tabular-nums`, `text-emerald-300` once met — the same acknowledgment accent `weekAtTarget`'s bar colour already uses. **Judgment call, flagged**: this whole block (and therefore the Today line with it) is gated behind `projection.state !== 'empty'`, so a fresh exam with no topics yet won't show its daily target until at least one topic exists, even though `DailyTarget` is otherwise decoupled from topics — the spec placed this line "under the weekly-bar section", which is itself inside that gate; restructuring around it was out of scope for this increment.
  - **`src/screens/Sprint.tsx`**'s `PostSprintView`: under the existing "N h remaining across all topics." line, `{n} of {target} today.` once a `dailyTarget` is set and today isn't the rest day — `n` freshly computed (including the sprint that was just ended) from the same re-queried `sprints` the remaining-hours line already trusts. Same emerald/slate tone rule as the overview's own line.
  - **Widget (`src/lib/widgetSnapshot.ts` + `PruefungWidgetProvider.java` + `widget_pruefung.xml`)**: `PruefungWidgetData` gains prebaked `todayLine: string | null` / `todayMet: boolean` (same ARCHITECTURE RULE every other widget field follows — computed in TS, never in Java), built from `exam.dailyTarget` directly rather than from `projection`, so it renders correctly even in the `emptyExam`/`neverReady` branches. The layout gains one `TextView` (`widget_line_today`, 12sp/`#94A3B8`) between the progress-bar row and the "This week: ..." line, hidden (`GONE`) whenever `todayLine` is null OR the snapshot is stale (a new one-day freshness guard, the daily analogue of the existing `weekIsCurrent` seven-day one — a snapshot that's sat unrefreshed since yesterday must not show yesterday's sprint count under today's label). Colour is set via a direct `setTextColor(int)` call rather than the progress bar's two-pre-coloured-view toggle — `setTextColor` is a plain `@RemotableViewMethod` on `TextView`, reliable across every API level this app's `minSdk` spans, unlike retinting a `ProgressDrawable`'s tint, which is what forced the bar's two-view workaround in the first place. `widget_pruefung_info.xml`'s `minHeight` bumped 84dp → 98dp for the extra row — same "judgment call, not a spec number, untested against a real launcher" caveat 0.40.0's own bump already carries.
  - 18 new tests total: `dailyShape.test.ts`'s 15 (above) plus 3 wiring checks in `widgetSnapshot.test.ts` (todayLine/todayMet null/false with no target; reports the count and met once reached; reads "Rest day." even with zero topics, pinning the decoupling-from-projection decision directly).
  - `npx cap sync android` ran clean, no new npm dependency. Android's Gradle build could not be run from this environment (no Android SDK/JDK toolchain here) — CI's Gradle job is the real verification for the Java/XML-side changes; `npm run typecheck && npm run test && npm run build` all pass from `apps/runway`.
  - `versionCode 56` / `versionName "0.41.0"`.

## 0.40.1
- **Twin templates, and the "undeletable" departure they left behind (field report #12).** The first field report diagnosed with the help of its attached activity log, not guesswork alone — the log showed exactly two `Departure created` lines and two `Alarms armed` lines for the same "punctual to work" morning, which is what pointed at DepartureSetup's save-with-repeat branch rather than anything in Home's delete path. Root cause: creating a new departure "from template" with Repeat left on unconditionally minted a SECOND template carrying the same schedule — the reported "duplicated template" — which then materialized its own parallel week of departures. Deleting one occurrence from Home never touched its twin's identical-looking sibling from the OTHER template, which read to Deepak as "I deleted this and it's still there" (the reported "unable to delete"). Compounding it: the form's Repeat toggle showed OFF for a from-template create even when the source template already repeated, inviting exactly the re-enable that triggered the twin.
  - **`src/screens/DepartureSetup.tsx`**: the populate-from-`sourceTemplate` effect now seeds `repeatEnabled`/`repeatTime`/`repeatDays` straight from `sourceTemplate.schedule` when it's non-null, so a from-template create shows Repeat correctly ON from the start. The save-with-repeat branch (`handleSave`) now reuses `sourceTemplate` instead of always creating a new template: `templateId` links to it whether or not Repeat ends up enabled (a one-off instance of a standing routine is still an instance, matching `buildDeparture`'s own unconditional `templateId` assignment for materializer-created rows); when Repeat is on and the form's time/days differ from the template's own `schedule` (`scheduleDiffers`, new pure helper — see below), the template's `schedule`+`updatedAt` are updated and `replaceUntouchedFutureAutoRows` clears the week already materialized under the old schedule before `materializeScheduledDepartures` re-plans it. Deliberately does NOT write the form's steps/travel/buffer minutes back to the template — a one-day tweak stays on that one departure. From-scratch creates (no source template) with Repeat on are unchanged: a new template is still the correct move there. New log line, `departure` category: "Departure linked to template: {name}." whenever a departure lands on an existing template through this path.
  - **`src/lib/recurrence.ts`**: new `scheduleDiffers(existing, next)` — order-insensitive comparison of a `TemplateSchedule`'s time and day-set, extracted as a pure function so the save path above can decide "does this need writing back to the template" without Dexie in the loop. Unit-tested directly (`recurrence.test.ts`): identical schedules, reordered-but-equal day sets, a changed time, day sets differing by length or by membership, and a `null` existing schedule.
  - **`src/lib/materialize.ts`**: `replaceUntouchedFutureAutoRows` now returns the count of departures it removed, instead of staying `void` — needed by the TemplateEdit log line below. Every existing call site (`Home.tsx`, `TemplateEdit.tsx`'s own save path, `autoLearn.ts`) already discards the return value, so this is additive, not a behavior change.
  - **`src/screens/TemplateEdit.tsx`**: `handleDelete` already swept future, untouched, auto-created departures of a deleted template (and cancelled their alarms via `cancelDepartureAlarms`, which already logs an `alarm`-category "Alarms cancelled" line) — this was verified against the report rather than assumed, and nothing there needed changing. What was missing was a log line naming the sweep itself: `handleDelete` now logs `departure`-category "Template deleted: {name}, {N} upcoming departures removed." using the count from `replaceUntouchedFutureAutoRows` above. This existing sweep is also what lets Deepak clean up the twin template on his own device once this build lands: deleting the duplicate template removes its future departures with it.

## 0.40.0
- **The one sanctioned bar, now on the home screen.** Field feedback, verbatim: the Prüfung widget is "just text against a black background" — three plain lines with no sense of how the week is going. ExamOverview.tsx already has exactly one progress bar in this whole app, the weekly one (week-scoped, resets every Monday — CLAUDE.md's "no bars, no streaks" rule has one sanctioned exception, and this is it, per that screen's own comment on why a bounded, resetting scope doesn't accumulate into the "a bar at 8% is demoralising" problem a topic-coverage bar would). This release mirrors that one bar onto the widget, and reorders/recolours the widget's three text lines around it so the card reads calm rather than decorated.
  - **`src/lib/widgetSnapshot.ts`**: `PruefungWidgetData` gains `weekProgressPercent` (`floor((logged/target) × 100)`, clamped to [0, 100]; 0 when there's no real weekly target — target `null` or `≤ 0`, the same condition `buildWeekLine`'s null branch already checks) and `weekAtTarget` (`logged >= target`, also `false` with no real target). Both new pure functions, `computeWeekProgressPercent`/`computeWeekAtTarget`, are exported and unit-tested directly with plain numbers (zero, partial, clamped-over-100, at-target boundary, and the null/non-positive-target guard) rather than only through `buildWidgetSnapshot` — pinning an exact target via `examProjection`'s real date/pace math would make the boundary and clamp cases fragile for no real coverage gain. Same ARCHITECTURE RULE as every other widget field in this file: the ratio and the emerald/sky decision are both computed here, never in `PruefungWidgetProvider.java`.
  - **Copy fix, noticed while building this**: `weekLine` was missing the colon `format.ts`'s own longer prose version of the same fact ("Ready by … needs … This week: x of y.") has always had — the widget's shorter line read "This week 1.5 of 6.5 h" where the live screen's line reads "This week: 2.0 of 6.5.". Fixed to "This week: 1.5 of 6.5 h" (and "This week: 1.5 h logged." in the no-target case) — an inconsistency, not a deliberate variant, so fixed rather than left as "close enough" per CLAUDE.md's "UI copy should be exact" rule.
  - **`res/layout/widget_pruefung.xml`**: adds a 6dp-tall weekly progress bar row below the ready-by line, and reorders the two dim lines so the exam anchor line — now smallest (11sp) and dimmest (`#64748B`, slate-500) — sits last, with the "This week: …" line (12sp, `#94A3B8`, slate-400, a step smaller than its old 13sp) directly under the bar instead. The bar itself is two `ProgressBar` views (`widget_progress_sky` / `widget_progress_emerald`) layered in one `FrameLayout` cell, visibility-toggled rather than retinted — RemoteViews can't reliably retint a drawable's tint across every API level this app's `minSdk` spans, so "two pre-coloured variants, show one" is the robust idiom, not a workaround (documented in both the layout and the provider). A 0% bar is never hidden — an empty track at rest IS the visual pressure this increment exists to add.
  - **Palette, verified rather than guessed**: `progress_sky.xml`/`progress_emerald.xml` (new layer-list drawables, track `#1E293B` / fill `#0EA5E9` and `#6EE7B7` respectively) were matched against the live bar's actual Tailwind classes (`ExamOverview.tsx`: `bg-emerald-300` at/past target, `bg-sky-500` below it, track `bg-slate-800`) by running `require('tailwindcss/colors')` against this app's own `tailwind.config.ts` (which extends the default palette with `surface`/`raised` only — sky/emerald/slate are untouched Tailwind defaults). **Deviation from the increment brief, flagged rather than silently corrected**: the brief specified "`#38BDF8` (sky-500) / `#34D399` (emerald-400)" — those hexes are actually Tailwind's sky-**400** and emerald-**400**, not sky-500 and the live bar's actual emerald-**300**. Real sky-500 is `#0EA5E9`; real emerald-300 is `#6EE7B7`. Used the verified values (matching the live bar exactly) rather than the brief's literal, mislabeled hex — the whole point of this increment is mirroring the one sanctioned bar, so fidelity to what it actually renders wins over a copied-down hex.
  - **`res/xml/widget_pruefung_info.xml`**: `minHeight` bumped 64dp → 84dp — the layout gained a fourth row (the bar plus its own top margin) between the ready-by line and the two remaining text lines. Still a judgment call, not a spec number, and still unverified against a real launcher grid (no Android SDK/emulator in this environment).
  - **`PruefungWidgetProvider.java`**: reads `weekProgressPercent`/`weekAtTarget` via `optInt`/`optBoolean` (same schema-upgrade tolerance idiom `emptyExam` already uses — a pre-0.40.0 snapshot defaults to a 0%, sky bar rather than throwing), calls `setProgressBar(id, 100, percent, false)` on whichever bar `weekAtTarget` says is visible, and does no arithmetic and no colour decision beyond that visibility pick — zero change to the file's existing ARCHITECTURE RULE. The bar is gated on the same `weekIsCurrent` stale-week guard the "This week" text line already used. **UNVERIFIED on device**: how `ProgressBar` actually renders inside One UI's own widget theming — no Android SDK/emulator available in this environment, same caveat every widget-info XML in this app already documents for itself.
  - **Padding audit** (per the increment brief — compare all three widget layouts' padding, only change Prüfung's this increment): all three (`widget_pruefung.xml`, `widget_departure.xml`, `widget_task.xml`) already use `android:padding="14dp"` on their root `LinearLayout`. No divergence found; no padding change needed or made.
  - 11 new tests (`widgetSnapshot.test.ts`): `computeWeekProgressPercent` (zero, floored partial, clamped over 100, at-target boundary, null/zero/negative target → 0 — 5 tests) and `computeWeekAtTarget` (below target, at-target boundary, past target, null/zero target → false — 4 tests), plus 2 `buildWidgetSnapshot` wiring checks (fields are 0/false with nothing logged, and 0/false once the anchor is today or past).
  - `npx cap sync android` ran clean, no new npm dependency. Android's Gradle build could not be run from this environment (no Android SDK/JDK toolchain here) — CI's Gradle job is the real verification for the Java/XML-side changes; `npm run typecheck && npm run test && npm run build` all pass from `apps/runway`.
  - `versionCode 54` / `versionName "0.40.0"`.

## 0.39.0
- **The last anti-rot surface — deadlines visible from the home screen.** 0.37.0 gave a deadline-bearing task an alarm; 0.38.0 gave a half-formed one a place to be captured without friction. Both still required opening the app to see. This release adds "Runway Tasks", a third home-screen widget alongside Prüfung and departure: up to three lines — the soonest armed deadline (name, bold, plus "due HH:mm[ · start by HH:mm]"), or "No armed deadlines." when nothing qualifies, plus an "{N} armed · {M} to arm" counts line whenever either number is nonzero. A glance at the home screen now shows exactly what Home's own "To arm" shelf and upcoming-tasks list would, with nothing opened.
  - **`src/lib/widgetSnapshot.ts`** gains `TaskWidgetData` and three new pure functions. `selectWidgetTask(now, tasks)` picks the soonest deadline among 'planned'/'running' tasks that carry one — deliberately WITHOUT the departure widget's past-threshold cutoff: an overdue task's deadline sorts before any future one and wins outright, because a missed deadline is the single most urgent fact on the board, not a stale one to hide (see that function's own doc comment for why this is the opposite judgment call from `selectUpcomingDeparture`'s). `formatTaskCountsLine(armedCount, toArmCount)` prebakes "{N} armed · {M} to arm", `null` when both are zero. `buildTaskWidgetData` composes the two, building the "due … · start by …" line via `taskStartBy` and dropping the start-by clause once it's already passed. Counting rule spelled out in both the code and this entry because it's easy to misread: `armedCount` is the TOTAL count of planned/running tasks — the headline task, when shown, is INCLUDED in it, never counted separately. `buildWidgetSnapshot` gains a sixth parameter, `tasks: WorkTask[]`, and `WidgetSnapshot.tasks` (unlike `pruefung`/`departure`) is never itself `null` — an empty tasks widget ("No armed deadlines.", no counts line) is a meaningful, always-buildable state, not a "nothing written yet" gap.
  - **`src/native/widgets.ts`**'s `refreshWidgets` now also queries `db.tasks` (statuses `'planned'`, `'running'`, `'captured'` — the three `buildTaskWidgetData` actually reads) and passes them through.
  - **Widget audit** (per the increment brief — verify every task create/start/done/abandon/reopen/capture/promote path calls `refreshWidgets`): it did not. Only `TaskRun.tsx`'s `handleReopen` had the call; `TaskSetup.tsx` had NONE at all (create, promote, capture, and discard-capture every saved/deleted a task row with no widget or day-gauge refresh afterward), and `TaskRun.tsx`'s `toggleUnit`, `handleStart`, `handleUnitBackdateConfirm`, and `handleAbandon` were all missing it too. Fixed at every one of those sites, pairing `refreshWidgets()` with `refreshDayGauge()` per `dayGaugeRefresh.ts`'s own documented rule ("anything that moves the widgets moves the gauge" — the day gauge already reads `db.tasks` for `nextCommitment`, so it had exactly the same gap). `toggleUnit`/`handleUnitBackdateConfirm` gate the pair on an actual status transition (`wasPlanned || becameDone`), matching the existing `cancelTaskAlarm`/`logEvent` gating in those functions — a same-status unit check/uncheck changes nothing either widget or the gauge reads. `handleStart` gates on `wasPlanned`; `handleAbandon` and `TaskSetup.tsx`'s three write paths are unconditional.
  - **Android**: `TaskWidgetProvider.java` (new) — zero date arithmetic, zero counting; every string it renders is already baked in the JSON snapshot (stricter than either existing provider, which each still do one small piece of native-side arithmetic of their own). Tap target is always `runway://home`, never a per-task deep link — this widget's job is "open the app at Home", not "jump into running this specific task". `res/layout/widget_task.xml` (3 TextViews, same `widget_bg` background and dim/bright colour split the other two widgets use), `res/xml/widget_task_info.xml` (same 180×64dp / 6h-update-period shape as the other two — see that file's own comment for why this widget's 6h timer isn't running an expiry check the way the departure widget's is), a `<receiver>` in `AndroidManifest.xml`, and `widget_task_label`/`widget_task_description` strings. `WidgetBridgePlugin.requestWidgetRefresh` now pokes all three providers, not two.
  - **`npx cap sync android`**: ran clean, same 7 npm Capacitor plugins as before — no new dependency (`TaskWidgetProvider`/`WidgetBridgePlugin` are this app's own native code, not an npm-installed plugin, same as the other two widget providers).
  - 13 new tests (`widgetSnapshot.test.ts`): `selectWidgetTask` (soonest wins, a past deadline still wins over a later future one, no-deadline excluded, captured excluded even with a deadline set, done/abandoned excluded, empty → null), `formatTaskCountsLine` (both zero → null, formats correctly whenever either is nonzero), and `buildWidgetSnapshot`'s tasks field (no tasks at all, nameLine/dueLine with the start-by clause present, start-by clause dropped once passed, armedCount includes the headline task itself, countsLine still reports even with no headline task).
  - Android's Gradle build could not be run from this environment (no Android SDK/JDK toolchain here) — CI's Gradle job is the real verification for the Java-side change; `npm run typecheck && npm run test && npm run build` all pass from `apps/runway`.
  - **UNVERIFIED on device**: how all three widgets actually lay out together on a real One UI launcher grid (sizing, the 3-cell-wide/1-cell-tall nominal placement, whether 64dp minHeight is enough for the tasks widget's three lines in practice) — no Android SDK/emulator available in this environment, same caveat every widget-info XML in this app already documents for itself.
  - `versionCode 53` / `versionName "0.39.0"`.

## 0.38.0
- **Capture costs one name; arming can wait — but the shelf is visible, which is what Todoist never gave him.** The second anti-rot increment. 0.37.0 gave a deadline-bearing task an alarm; this one attacks the earlier failure mode — a half-formed obligation ("send PhD documents") never gets typed in at all because TaskSetup demands name + units + minutes before it'll save anything. Todoist's overdue pile proved what happens to a task captured somewhere dateless and invisible: it rots. This release lets a name alone be saved — parked on a calm, visible Home shelf, armed later with one tap — so the friction of "I have to plan this right now" is no longer the reason it never gets written down.
  - **`src/db/types.ts`**: `TaskStatus` gains `'captured'` — a name-only task (`units: []`, `deadlineAt`/`startedAt` both `null`) awaiting arming, the ONE status that never reaches `TaskRun.tsx`. No Dexie version bump: `status` was already an indexed field (`db.ts`'s `tasks: 'id, status, createdAt'`), and a new VALUE on an existing indexed field needs no `version()` call, only a new indexed FIELD would.
  - **`TaskSetup.tsx`** gains two things. (1) A "Capture for later" `TextAction` on the ordinary create form, enabled once the name field is non-empty, deliberately skipping every other field's validation — that's the whole point of capture. (2) Promote mode, entered via the `App.tsx` `Screen` union's new optional `taskSetup.capturedTaskId`: loads the existing 'captured' row, prefills the name, and on Save UPDATEs that same row (units/deadline/status `'planned'`) instead of adding a second one — `createdAt` is deliberately left untouched, so "this sat on the shelf for 6 days" stays honest history rather than being erased by arming. `scheduleTaskAlarm` then runs exactly as it does on an ordinary create. A "Discard capture" action (promote mode only) deletes the row outright — `window.confirm("Discard this capture? {name} is deleted.")` — rather than marking it `'abandoned'`, since a capture that never became a plan has no run to abandon.
  - **`Home.tsx`** gains a "To arm" section between the two-up create-button row and Tasks: every `'captured'` task, oldest first (the longest-parked capture needs eyes most), capped at 3 with the existing "+N more" pattern, no empty state (an absent shelf says nothing worth saying). Each card: the name, and one quiet `text-sm text-slate-500` line — `"Captured {date}."` — a bare ISO-adjacent display date, deliberately NOT a day count. CLAUDE.md, binding: a date is a fact; "N days ago" is a countdown toward guilt, exactly the shape this shelf exists to avoid. Never red, regardless of how long a capture sits there. Tap opens `TaskSetup` in promote mode.
  - **`src/lib/taskProjection.ts`** gained `capturedShelf(tasks): WorkTask[]` (new, pure) — filters to `status === 'captured'`, sorts oldest-`createdAt`-first, deliberately uncapped (Home applies its own render-time cap, same "cap the list, not the data" split `collapsedUpcoming` already uses).
  - **Status-filter audit** (every place that queries tasks by status, checked against the new `'captured'` value): Home's `tasksInProgress` (`anyOf(['planned','running'])`) — excludes ✓. `dayGauge.ts`'s `nextCommitment` (`status !== 'planned' && status !== 'running'` skip) — excludes ✓. `History.tsx`'s finished-tasks query (`anyOf(['done','abandoned'])`) — excludes ✓. `learning.ts`'s `isEligibleTaskRun`/`naturalTasks` (`status === 'done'`) — excludes ✓; `stepNameLibrary`'s name corpus intentionally takes tasks of ANY status (same "even a planned/abandoned run typed a real name worth remembering" reasoning already documented for departures) — a captured task's name is exactly as real, so this one is correct to include it, not a gap. `restoreBackup.ts`'s task re-arm sweep (`status === 'planned'`) — excludes ✓. `widgetSnapshot.ts` — never reads the `tasks` table at all, nothing to check. No filter needed fixing; all were already explicit about which statuses they wanted.
  - 4 new tests (`taskProjection.test.ts`, `capturedShelf`): filters to captured-only, sorts oldest-first, empty input, ignores every other status.
  - No Dexie bump, no native/Java change — `cap sync` skipped. `versionCode 52` / `versionName "0.38.0"`.

## 0.37.0
- **Tasks stop relying on remembering they exist — the first anti-rot increment.** The user's own framing, kept verbatim: reminders/alarms need to be "robuster" so tasks stop rotting. A departure has four staged exact alarms; a task had zero (a code comment in `TaskRun.tsx` even used to say so) — the live TaskRun screen was the entire instrument, which works fine once a task is opened, and does nothing at all for one that never gets opened. This release gives a deadline-bearing task exactly ONE exact alarm, at its start-by moment, not a staged ladder: a task has no travel/buffer/arrival phases to stage against, and CLAUDE.md's "defaults lean toward less, not more" rule applies directly — a second, earlier heads-up alarm is a real option to add later if actual use asks for it, not something to build speculatively now. (`versionCode 50` was never used — skipped straight to 51, intentionally, not a gap to chase down.)
  - **`src/lib/taskProjection.ts`** gained `taskStartBy(task): Date | null` (new, pure) — `deadlineAt` minus the sum of EVERY unit's planned minutes (the full plan, not `taskProjection`'s remaining-only sum — see its own doc comment for why those two are honestly different questions). `null` with no deadline. Deliberately does not decide whether the result has already passed — that's the scheduler's call, not this function's.
  - **`src/native/notifications.ts`** gained `taskStartByNotificationId(taskId)` (`notificationId('task-${taskId}', 0)`, same bare-id-reuse pattern as `sprintNotificationId`/`milestoneNotificationId`/`studyBlockNotificationId`), `scheduleTaskAlarm(task)`, and `cancelTaskAlarm(taskId, name)`. `scheduleTaskAlarm` no-ops off native, off `status !== 'planned'`, off a null deadline, and — the one that matters most — off an already-past start-by instant: an alarm firing the moment a tight task is saved would be noise, not help, and the projection UI already tells that story honestly. Body: *"Start now to finish by {HH:mm}. {name}"*, title "Runway", the gentler staged channel, `allowWhileIdle` exact, the same snooze action type ("Snooze 10 min") a departure's first stage gets — the existing generic snooze-reschedule path needed no task-specific code at all.
  - **Tap routing**: `registerNotificationNavigation` gained a third callback, `onTaskTap(taskId)`, checked ahead of the existing departure fallback (same reasoning `onStudyBlockTap` already established: a task alarm's `extra` has no `departureId` to fall through on either) — `main.tsx` wires it to `navigateToScreen({ name: 'task', taskId })`.
  - **Lifecycle wiring**: `TaskSetup.tsx`'s save path (create-only — see below) requests notification permission lazily, only when a deadline was actually set, then calls `scheduleTaskAlarm` — same "ask on first real use, not at launch" pattern `DepartureSetup.tsx` already uses. `TaskRun.tsx` calls `cancelTaskAlarm` from every path that ends the never-started window: `handleStart`, the auto-start branch inside `toggleUnit` (checking a unit also starts a still-planned task), the done branch of both `toggleUnit` and `handleUnitBackdateConfirm`, and `handleAbandon`. **Reopen (0.34.1)** deliberately does NOT re-arm anything — it lands the task on `'running'`, not `'planned'`, and a reopened task is already being worked, not newly forgotten.
  - **`TaskSetup.tsx` has no edit path** (verified against its own doc comment and the `App.tsx` `Screen` union, which gives `taskSetup` no `taskId` to edit) — so there is no second reschedule call site to wire; a task's alarm is set exactly once, at creation.
  - **`restoreBackup.ts`** gained its own try/catch re-arm step for tasks, beside the existing departure one: `status === 'planned'` and a still-future `deadlineAt` are the eligibility filter (mirroring the departure filter's own two conditions), `ensurePermissions()` once for the batch, `scheduleTaskAlarm` per eligible task.
  - **README**'s "Tasks" section no longer claims "no scheduled notifications" — that line described a real gap, not a permanent design decision, and this release closes it.
  - 5 new tests (`taskProjection.test.ts`, `taskStartBy`): the normal case, no-deadline → null, a multi-unit sum with different per-unit lengths, summing ALL units (including already-checked ones, not just the remaining sum `taskProjection` computes), and an already-past instant still returning a Date rather than null (the scheduler, not this pure function, decides past-ness).
  - No Dexie bump, no native/Java change — `cap sync` skipped. `versionCode 51` / `versionName "0.37.0"`.

## 0.36.1
- **"No paired Bluetooth devices found" with a car that WAS paired — one message was covering four different failures, and the radio-off case was the real one in the field.** Field report, verbatim shape: "Choose car" showed the no-devices message while the car was genuinely paired and Android's own App-permissions screen confirmed Nearby devices was Allowed. Root cause: `BluetoothAdapter.getBondedDevices()` is documented to return an EMPTY SET whenever the Bluetooth radio isn't `STATE_ON` — a radio toggled off at that exact moment reads as "nothing paired," indistinguishable from an actually-empty bond list once collapsed into one sentence. The old flow had exactly one error string standing in for permission-not-granted, radio-off, a failed read, and a genuinely empty list; this release tells them apart.
  - **`BluetoothBridgePlugin.getBondedDevices`** now resolves `{ devices, permitted, radio }` instead of just `{ devices }` — `radio` is `'on' | 'off' | 'unavailable' | 'error'`, read via `adapter.isEnabled()` (no extra permission needed on any target SDK) before ever calling `getBondedDevices()`, so "off" is reported directly rather than inferred from an empty list. A caught `SecurityException` (the same OEM inconsistency this method already defended against) now reports `'error'` instead of silently returning an empty list.
  - **`src/native/bluetooth.ts`**'s `getBondedDevices` surfaces the richer `BondedDevicesResult`; the web/error fallback is `{ devices: [], permitted: false, radio: 'unavailable' }`.
  - **`src/lib/transit.ts`** gained `carChooserMessage(granted, permitted, radio, deviceCount)` (new, pure) — the one place the branch order (permission, then radio, then read failure, then genuinely-empty) lives, so a future Settings.tsx edit can't silently reorder which cause wins. Four messages, all `text-amber-400` like the one they replace: *"Bluetooth permission was not granted. Allow Nearby devices for Runway in Android settings."*, *"Bluetooth is turned off. Turn it on, then choose again."*, *"The paired-device list could not be read. Try again, and report it if it persists."*, and the original *"No paired Bluetooth devices found. Pair your car in Android Settings first."* for the one case where that sentence was always true.
  - **Settings.tsx**'s "Choose car" flow now shows a "Try again" TextAction beside "Cancel" whenever a message (not the device list) is showing — "Try again" re-runs permission + radio + device read from scratch, since any of the three could have changed since the last attempt.
  - **Instrumented** (`'transit'` event category): one line per chooser attempt — `"Car chooser: permitted={p}, radio={r}, {n} devices."` — so the activity log names the actual cause even when a field report only describes the symptom. `chooseCar`'s existing log line was reworded to the spec text `"Watching car: {name}."` (previously `"Car Bluetooth watching enabled: {name}."`) rather than adding a second, redundant line for the same event.
  - 7 new tests (`transit.test.ts`): `carChooserMessage`'s branch order — permission-not-granted (both the ensurePermission and the getBondedDevices `permitted` sources), radio-off ahead of device count, both non-`'on'` read-failure radio states, the genuinely-empty-list fallback, and the null ("show the list") case.
  - Android's Gradle build could not be run from this environment (no Android SDK/JDK toolchain here) — CI's Gradle job is the real verification for the Java-side change; `npm run typecheck && npm run test && npm run build` all pass from `apps/runway`.
  - `versionCode 49` / `versionName "0.36.1"`.

## 0.36.0
- **The car already knows the transit time; Runway now listens.** The user's own framing, kept verbatim because it's exactly the insight this release turns into code: "My car will automatically connect to the phone's Bluetooth and the transit times could be perfectly calibrated and calculated once the phone connects to the Bluetooth and stays in the Bluetooth connection till the connection ends. That is actually the whole transit time." A chosen car's Bluetooth connect-to-disconnect span IS a drive, measured with zero estimating and zero app interaction — this release wires that measurement into the exact suggestion machinery `travelMinutes` already has, offered, never silently applied (CLAUDE.md, binding).
  - **`BluetoothTransitReceiver.java`** (new) — a manifest-declared `BroadcastReceiver` for `ACL_CONNECTED`/`ACL_DISCONNECTED`. These two actions are on Android's implicit-broadcast exemption list: unlike most implicit broadcasts (which stopped reaching a killed app's manifest receiver as of Android 8), this pair still fires with Runway fully swiped away, no foreground service, no persistent listener. Fires only for the ONE device address chosen in Settings — every other paired device's connect/disconnect is ignored at the top of `onReceive`, a deliberate privacy scope: Runway records one chosen car's drive history, never a general Bluetooth-device log. Appends a compact `{a: 'c'|'d', at: epochMs}` line to a SharedPreferences ring, capped at 200 entries.
  - **`BluetoothBridgePlugin.java`** (new, registered in `MainActivity` before `super.onCreate()` like the other four) — `ensurePermission` (BLUETOOTH_CONNECT on API 31+, auto-granted below it), `getBondedDevices`, `setWatchedDevice`/`clearWatchedDevice` (clears the ring on every change — an old car's drives must never blend into a new one's history), `readTransitEvents`.
  - **`src/lib/transit.ts`** (new, pure) — `transitWindows` pairs each connect with the next disconnect (dropping a dangling connect — a drive still in progress — and an orphan disconnect from ring truncation), discards anything under `MIN_DRIVE_MINUTES` (3 — sitting in a parked car isn't a drive). `matchTransitsToDepartures` attributes each window to the left/done departure whose `[leftAt, arrivedAt ?? appointmentAt+2h]` span covers the window's start, closest `leftAt` wins, at most one departure per window. `transitSuggestions` needs 3+ measured drives per departure name (same evidence floor `learnedEstimate` uses) before proposing a template's `travelMinutes` move to the measured median, and only when the drift is 3+ minutes.
  - **`src/lib/transitSync.ts`** (new) — the Dexie-touching orchestrator: reads native events, computes windows, matches them, merges new measurements into a JSON settings row (`transitMeasurements`, name → capped-20 array of `{minutes, atMs}` — a keyed row, not a new Dexie table: one car's drive history doesn't earn a schema bump). A monotonic sync cursor (`transitSyncCursorMs`) is what keeps a re-run from re-processing the same drive twice. Logs a `'transit'` event per new drive, matched or not — a new `EventCategory` (`src/db/types.ts`). Called fire-and-forget from `main.tsx`, beside the other startup materializers.
  - **Settings** gained a "Car Bluetooth" section (after Focus sound): "Choose car" → permission → a list of paired devices to tap → "Watching: {name}." + "Stop watching". Caption: *"Drives are measured from your car's Bluetooth connect to disconnect and refine travel-time suggestions. Samsung may stop delivering Bluetooth events to apps it puts to sleep — exclude Runway from battery optimization if drives stop appearing."*
  - **Home** renders transit suggestions with the same card pattern as buffer suggestions, its own dismissal-Set key prefix (`transit::`). Apply writes only `travelMinutes` (no provenance field exists for it, unlike a step's `estimateSource`) and logs `"Travel time updated from measured drives: {name}, {N} min."`
  - **Learning** gained a "Transit" section (after Departures, before Prüfung), rendered only once a drive has been measured: one line per name, `"{name}: median {M} min over {N} drives."`
  - **No background scanning, ever** — worth stating plainly since it's easy to misread "Bluetooth feature" as one: Runway never scans for devices. The OS pushes ACL events for a device already paired through Android's own Bluetooth settings; this app only reads the bonded-device list once, at "Choose car" time.
  - **UNVERIFIED, stated plainly rather than assumed**: whether the receiver actually fires reliably on a real Samsung S25 Ultra, closed-app included, has not been tried on-device as of this release — the Android-documented broadcast-exemption mechanism is real, but Samsung's OWN battery/app-standby deep sleep is a separate, harsher mechanism this receiver has no way to detect or work around from inside the app; the Settings caption's "exclude Runway from battery optimization" line is the mitigation, not a guarantee.
  - No new npm plugin — `BluetoothBridge` is custom Java, same as `WifiBridge`/`CalendarBridge`/`DayGauge` — `npx cap sync android` stays at 7 npm plugins.
  - 22 new tests (`transit.test.ts`): window pairing (dangling connect, orphan disconnect, the minute floor, a second connect overwriting a pending one, unsorted input), departure matching (span bounds, the arrivedAt fallback, closest-leftAt tiebreak), and the suggestion/summary evidence floors.
  - `versionCode 48` / `versionName "0.36.0"`.

## 0.35.1
- **Arrival steps, visible before they matter — and reorderable where they're edited.** Field report, verbatim: "now the after arrival steps are all missing. i had saved them, they seem to be hidden. also need an option to reorder the steps in their chronological order." Nothing was actually dropping arrival steps — both editors save them, `materialize.ts` copies them across untouched — but the Runway screen never showed a trace of them until the moment "I'm out the door" was tapped, which reads exactly like "lost" from the other side of the screen. Two fixes, both scoped to what the report actually named.
  - **Runway.tsx** gained an "After arrival" preview, RUNNING state only, shown once the prep-steps list (and its related panels) is done: a quiet section header plus one read-only line — `"Change into scrubs · Lift · Ward station — 12 min."` — pulled from the new **`arrivalPreviewLine(steps)`** in `src/lib/strandedArrival.ts` (that file already owns arrival-steps presentation strings; this is the third). Deliberately not tappable: these steps only become interactive once the arrival phase actually starts, and a preview that looked checkable would invite a tap that does nothing yet.
  - **DepartureSetup.tsx** gained `moveStep`/`moveArrivalStep`, mirroring TemplateEdit's own reorder functions and up/down button pair verbatim (same aria-labels, same swap-with-neighbor idiom) — DepartureSetup used to deliberately omit this, on the reasoning that TemplateEdit was the one place that needed it. That reasoning is reversed here by direct request. Reordering is allowed even while editing a running departure (`isEditingRunning`): checked, and both `computeProjection` and `currentStepAnchor` read step order in ways that are insensitive to swaps across a checked/unchecked boundary (see `moveStep`'s own comment in DepartureSetup.tsx) — reordering can only ever change which unchecked step comes next, which is exactly the point, and never corrupts the projection math or the checked-step history.
  - 3 new tests (`strandedArrival.test.ts`): `arrivalPreviewLine` — multiple steps, a single step, and the empty-list case (never actually rendered, since the caller length-guards first, but tested honest anyway).
  - No Dexie bump, no native change, `cap sync` skipped. `versionCode 47` / `versionName "0.35.1"`.

## 0.35.0
- **Activity log — two field bugs diagnosed blind; the app now keeps its own account of what it did.** Both 0.34.1 ("a task was taken as completed by an accidental touch") and 0.34.2 ("a departure with arrival steps was stranded when Android killed the app mid-drive") had to be diagnosed by reading code and reconstructing what must have happened — the app kept no record of what it actually did or when, so every bug report started from a user's memory of events, not a trail. This release ships a local, capped event log; a viewer screen; and an opt-in attachment to field reports. Local-first stays binding: nothing here leaves the device except when Deepak explicitly shares the log or attaches it to a report.
  - **`src/lib/eventLog.ts`** (new) — `logEvent(category, message)`, fire-and-forget and never-throwing, writes one flat row (`{ id, at, category, message }`, no free-form data blob — a category and one exact sentence is enough to trace a bug, and staying flat means a log call can never accidentally serialize a whole Departure/Task object into a row). Ten categories: `lifecycle`, `departure`, `task`, `sprint`, `arrival`, `alarm`, `gauge`, `backup`, `report`, `navigation`. The log's own rule, stated at the module's head: it answers "what did the app DO", never "what did the user see" — no render, no query, no screen mount gets a line; a departure created, an alarm armed, an arrival detected, a task finishing do.
  - **Dexie v6** adds the `events` table (`id, at`). `pruneEventLog()` keeps the newest 2000 rows, called once on every app open (main.tsx, beside the other startup materializers) rather than after every write — one cheap pass beats a `count()` on every single `logEvent` call, which in this app happens on nearly every user action.
  - **Instrumented every write site the two field bugs above would have needed**: departure created/edited/started/left/done(with result)/abandoned/re-anchored/replanned; arrival via Wi-Fi, the `runway://arrived` shortcut, the manual button, each arrival-step check and backdate; task created/started/unit checked/unchecked/done/reopened/abandoned/backdated; sprint started/ended; alarms armed/cancelled (inside `notifications.ts`'s own scheduler, so every caller is covered once) and study-block re-arms; notification taps and deep links; backup export/restore; field-report submit/sync. The day gauge's "shown/hidden" events are deliberately DE-DUPED against the last logged state (`dayGaugeRefresh.ts`) — that function runs on almost every write in the app, and logging every call unchanged would flood the 2000-row cap with gauge noise and crowd out the events actually worth tracing.
  - **`src/screens/ActivityLog.tsx`** (new) — reached from a new "Activity log" section on Settings (caption: *"What the app did and when, kept on this phone. The newest 2000 events are retained."*). Reverse-chronological, day-grouped, monospace-ish small lines; a "Share log" action hands the last 500 lines to the OS share sheet (clipboard on desktop web). Empty state: *"Nothing logged yet."*
  - **ReportProblem.tsx** gained a default-OFF "Attach recent activity log" checkbox, caption: *"The last 50 events are appended to the report. The report repo is public — check the log for anything you would not post publicly."* When checked, the last 50 formatted lines are snapshotted onto the `FieldReport` row at SAVE time (a new `activityLog: string[] | null` field) — not re-read at sync time, so an offline-queued report keeps the log it was filed with, not whatever the log says once a token finally lets it sync. `reportSync.ts`'s `buildIssuePayload` appends a fenced `## Activity log (last 50 events)` section when present.
  - **`backup.ts`/`restoreBackup.ts`** gained `events` in their table lists — the log travels with a backup like everything else Runway has learned; an old backup without it restores as empty (`?? []`).
  - 14 new tests: `eventLog.test.ts` (9 — pruning math, never-throws under a simulated broken db, line formatting, read ordering; db-touching functions are thin wrappers verified with a mocked `db` module, since no existing test in this app uses a real/fake IndexedDB), plus `backTarget.test.ts` and `reportSync.test.ts` coverage for the new screen and the new payload section.
  - `versionCode 46` / `versionName "0.35.0"`.

## 0.34.2
- **The door back — a departure with arrival steps had no way home after the app died mid-drive.** Field bug, real user report: he tapped "I'm out the door" on "punctual to work" (arrival steps: scrubs, lift, station), drove, and Android killed the backgrounded app. On relaunch the departure was gone from every screen — Home's `waitingOnArrival` query has, since the arrival-steps increment, deliberately EXCLUDED exactly this set (arrival-steps departures resolve more precisely through Runway.tsx's own arrival phase), on the assumption he'd stay on that screen through the whole phase. That assumption is only ever true for a foregrounded app. The row was never actually lost — status 'left', `leftAt` stamped, arrival steps sitting untouched in Dexie — but nothing pointed back to it, and History's departure rows aren't tappable either. Data was never at risk here; the door back was.
  - **`src/lib/strandedArrival.ts`** (new, pure) — `strandedInArrival(departure)`, the predicate this bug needed: true for a `left` departure with a non-empty `arrivalSteps`, regardless of whether `arrivedAt` is set yet. `strandedArrivalLine(departure)` builds the card's state line: `"En route · arrival steps waiting."` before the arrival phase starts, `"Arrived · {N} of {M} arrival steps done."` once it has. 9 new tests.
  - **Home.tsx** gained a `strandedArrivals` query (same `status === 'left'` scope as `waitingOnArrival`, soonest-appointment-first) rendering as tappable Cards inside the EXISTING "Waiting on arrival" section, above the plain Early/On time/Late confirm rows — same header, same "you left, this isn't finished" semantic, just a different resolution path (the real checklist on Runway, not a coarse guess here). Tapping one lands on `{ name: 'runway', departureId }`, which resumes the arrival-phase checklist exactly where it was left. The section's "no empty state" rule is unchanged — still nothing rendered when both lists are empty.
  - **Verified, not assumed**: read through Runway.tsx's `arrivalPhaseActive` branch before touching anything — it's already checked ahead of `justLeft` (line ~664 vs. ~924) and depends on no in-session-only state (`focusStepId`/`stepBackdateOpen`/`arrivedBackdateOpen` all default cleanly on a fresh mount), so it resumes correctly on a cold navigation after an app restart. No change needed there — the break was entirely in Home's missing surface.
  - `versionCode 45` / `versionName "0.34.2"`.

## 0.34.1
- **Reopen — an accidental tap could finish a task with no way back.** Field bug, real user report: "accidental touch caused a task called send Antrag for innovation prize to be taken as completed ... i cant go into history and continue that task." Checking a task's final unit auto-resolves it to 'done' with no confirmation step (TaskRun.tsx's `toggleUnit`) — a stray tap does that just as easily as a deliberate one, and until this release, the done summary offered only "Back to home" and History's task rows weren't even tappable. This release closes both ends.
  - **TaskRun's done summary** gained a quiet "Reopen — undo the last check-off." (TextAction, same weight as "Tell them" above it, deliberately smaller than "Back to home"). It clears the `checkedAt` of the unit found by the new **`lastCheckedUnitId(task)`** (`src/lib/taskProjection.ts`, pure — mirrors `taskFinishedAt`'s own max-checkedAt logic to answer "which unit" instead of "when") and puts the task back to 'running', in one `db.tasks.modify()` write. Deliberately undoes exactly ONE check-off, not an open-ended undo — that's the specific misfire this exists to correct. A task finished wrongly several units back isn't stuck either: once it's 'running' again, tapping a checked unit in the unit list unchecks it directly — `toggleUnit` already toggled both ways before this release (verified while building this, not new behaviour), so Reopen is effectively repeatable one unit at a time from there.
  - **No Reopen on the abandoned state** — abandoning is an explicit chosen action with its own confirm dialog, not an accidental tap, so it isn't this bug. Noted as a possible future extension if a real need shows up.
  - Reopening removes the poisoned actual from the learning pools for free — `deriveTaskUnitActuals` only pairs checked units, so clearing the accidental `checkedAt` is the only cleanup needed. It also calls `refreshWidgets()`/`refreshDayGauge()` — a reopened task's deadline re-enters both candidate pools, same "anything that moves the widgets moves the gauge" pairing rule every other status-changing write already follows.
  - **History's task rows are now tappable** (`src/screens/History.tsx`) — they were plain, non-tappable divs, which is the other half of the reported dead end ("i cant go into history and continue that task"). Now built on `Card` (a real `<button>`, the same component Home's own rows use), landing on TaskRun's done summary — where Reopen now lives. Departure rows in the same screen are deliberately left non-tappable this increment: a finished/abandoned departure has no equivalent reopen destination, so making it tappable would just be a dead end dressed up as an affordance.
  - 4 new tests (`src/lib/taskProjection.test.ts`): `lastCheckedUnitId` — normal max-find, a tie (documented as "first encountered wins," not a principled answer), no checked units, and an empty unit list.
  - No Dexie bump, no new plugin. `versionCode 44` / `versionName "0.34.1"`.

## 0.34.0
- **Witness — the accountability half of body doubling, with zero infrastructure.** Body-doubling increment A (0.33.0) shipped the ambient half — focus sound as company that asks nothing back. The active ingredient of accountability-style body doubling is different: precommitment with a witness, telling one real person "I'm starting 50 minutes on X, I'll report back at 20:15" and then reporting the finish. This release is that, and nothing more — one tap composes the message, a human (WhatsApp, a text, whatever) does the rest. Nothing is ever sent automatically, nothing about whether or to whom Deepak shared is recorded anywhere, and abandoning offers no share at all.
  - **`src/lib/witness.ts`** (new, pure) — four message builders: `sprintStartMessage`/`sprintDoneMessage` ("Starting: 50 min on Neuroanatomy. I'll report back at 20:15." / "Done: 48 min on Neuroanatomy."), `taskStartMessage`/`taskDoneMessage` ("Starting: Befunden EEG, 5 units. I'll report by 16:00." with a deadline, "...5 units, about 75 min." without one; "Done: Befunden EEG — 5 units · 82 min." mirroring the done summary's own phrasing verbatim). `reportAt` is always computed by the CALLER (now + planned minutes), keeping these testable without touching the system clock.
  - **`src/native/shareText.ts`** (new) — `shareWitnessText(text)`, the one file that shares plain text (distinct from `backupFile.ts`, which shares a file). Native: `Share.share({ text })`, no file. A dismissed share sheet REJECTS on Android with a "Share canceled" message — same lesson `backupFile.ts`'s 0.32.0 review fix already learned, applied here too: that's a decision, not an error, so it resolves `'dismissed'`, not `'unavailable'`. Web: `navigator.share` when the browser has it (same result mapping, including an `AbortError` dismissal); otherwise `navigator.clipboard.writeText` and resolves `'shared'` — on desktop that really means "copied, paste it yourself," which is why the UI never claims a message was actually sent. No new plugin — `@capacitor/share` has been installed since 0.32.0.
  - **Sprint.tsx and TaskRun.tsx** each gained two quiet TextActions (never Button — this has to stay smaller than "End sprint"/"Back to home"/"Abandon this task" around it): "Tell someone" on the live/running view (Sprint's RUNNING state, TaskRun's `status === 'running'`), "Tell them" on the finish summary (Sprint's `PostSprintView` — the one-time post-sprint screen, confirmed to exist by reading the component before writing anything — and TaskRun's `status === 'done'` block). Both done-side messages reuse the exact actual-minutes figure the summary already computes and displays; nothing is re-derived a second way. A share that resolves `'shared'` or `'dismissed'` changes nothing on screen — the share sheet itself is the feedback, and a dismissal is Deepak's own call not to send it, not something to flag. Only `'unavailable'` shows a line, "Sharing is not available here.", cleared on the next attempt.
  - **No share on abandon, anywhere** — TaskRun's abandoned-state render carries the rule as a standing comment (Sprint has no abandoned state at all to carry one, since ending a sprint is always honest logging, never a discard). A witness ritual is start and finish, never confession; CLAUDE.md's anti-shame rule is binding here.
  - **Nothing persisted to Dexie about any of this** — no flag for whether a share was attempted, completed, or to whom. Recording "did he tell someone" would build exactly the surveillance ledger this feature exists to not be.
  - 8 new tests (`src/lib/witness.test.ts`): all four builders, singular/plural units, the deadline/no-deadline branch, HH:mm padding. No Dexie bump, no new plugin, `cap sync` skipped (nothing native changed).

## 0.33.0
- **Focus sound — the unwatched-video hack, without the algorithm.** Deepak's own self-discovered ADHD trick for unpalatable work is an unwatched YouTube video running in the background: non-contingent auditory stimulation, the "moderate brain arousal" effect Söderlund's white-noise-in-ADHD studies describe. This release gives him that mechanism natively — steady generated noise during Prüfung sprints and task runs, with no feed on the other side trying to win his attention back.
  - **`src/audio/focusSound.ts`** (new directory — the one WebAudio choke point in this app, not `lib/` and not `native/`, see its own header comment) — a module-level singleton (one `AudioContext`, one looping `AudioBufferSourceNode`, one `GainNode`), lazily created on the first `startFocusSound()` call because browsers/WebViews require a user gesture before audio, and every call site here is a tap handler. Three pure generators, exported for tests and DOM-free (`whiteNoise`, `pinkNoise` via Paul Kellet's filter approximation, `brownNoise` via a leaky-integrated random walk normalized to a ~0.9 peak so all three read as comparably loud at the same slider position), each building a ~4-second looping buffer — long enough that noise's lack of pitch or rhythm makes the loop seam inaudible without needing an explicit crossfade. Gain follows `volume²` (a cheap approximation of equal-loudness perception). `stopFocusSound()` is idempotent and never throws — wrapped in try/catch, because a WebAudio hiccup on a finish/abandon path must never be what breaks that path.
  - **`src/lib/focusSoundSettings.ts`** (new) — three rows in the existing `settings` table: `focusSoundKind` (`'brown'` default — least hissy of the three, judged most comfortable across a full 50-minute sprint), `focusSoundVolume` (`'0'`–`'100'`, default `'40'`), `focusSoundOn` (absent/`'false'` = off — CLAUDE.md's "defaults lean toward less" rule, a fresh install should never start making noise nobody asked for). `readFocusSoundConfig()` is the one place that reads all three with their defaults.
  - **Settings gained a "Focus sound" section** (after Day gauge): Brown/Pink/White chips (same visual language as ExamSetup's length chips) and a volume slider, caption verbatim: *"Steady noise under sprints and tasks. Moderate background stimulation makes boring work easier to hold — the job the unwatched video was doing, without the feed."* Deliberately **no enable toggle here** — Settings configures what the sound is, never whether it's making noise right now; that decision belongs on the live screen, at the moment work actually starts. If a kind/volume change happens while the engine is actually playing (a sprint left running while Settings happens to be open), it retunes live rather than waiting for the next mount.
  - **Sprint.tsx and TaskRun.tsx** each gained a quiet "Focus sound: on"/"off" toggle row, RUNNING state only (TaskRun: `status === 'running'`, matching its existing keep-awake scoping — a task not yet started has nothing to hold background noise for). Tapping flips `focusSoundOn` and starts/stops the engine immediately. The preference is remembered, not reset: turn it on once and every later sprint or task starts with the sound already going, with nothing to re-arm. `stopFocusSound()` is called unconditionally from every exit path — finish, abandon, and the mount effect's own cleanup — the cleanup is the reliable net underneath the explicit calls, not a replacement for them.
  - **Two honest UNVERIFIED gaps**, stated plainly rather than glossed over (see `focusSound.ts`'s header comment): whether WebView audio keeps playing with the screen off outside the keep-awake window Sprint/TaskRun already hold, and how this interacts with other audio already playing on the phone — a Capacitor WebView doesn't request Android audio focus the way a native music app does, so there's no ducking contract with anything else making sound. Both need the real device to check.
  - Departures (Runway.tsx) are explicitly out of scope this increment — a possible extension, not forgotten.
  - 11 new tests (`src/audio/focusSound.test.ts`): value ranges for all three generators, brown-noise peak normalization and boundedness, pink-filter stability over 1e6 samples. No new plugin, no Dexie bump, `cap sync` skipped (nothing native changed).

## 0.32.0
- **Backup — the brain of the app is now portable.** Everything Runway has learned lives in one IndexedDB on one phone: departure/task actuals feeding the P75 estimates, rushed-compression floors, estimate provenance, exam sprints and milestones, the whole record. Until this release, a lost or wiped phone meant losing all of it, with no way back. This ships manual export/import of the full database as one JSON file.
  - **`src/lib/backup.ts`** (new, pure) — `buildBackup(tables, schemaVersion, exportedAt)` assembles `{ app: 'runway', schemaVersion, appVersion, exportedAt, tables }` from every one of db.ts's nine tables (templates, departures, settings, exams, topics, sprints, milestones, fieldReports, tasks), with `settings` filtered of `SECRET_SETTING_KEYS` — the Google Routes API key, the Gemini API key, and the GitHub field-report token. A backup file's whole purpose is to travel (Drive, email, a second phone); re-obtaining a key is cheap, a leaked one is not. `validateBackup(parsed, currentSchemaVersion)` rejects anything not shaped like a Runway backup, and separately rejects a backup from a NEWER schema than the app currently understands ("This backup is from a newer Runway (schema v{N}). Update the app first, then import.") while accepting an OLDER one — this app's universal undefined-as-null discipline already tolerates rows missing newer fields.
  - **`src/lib/restoreBackup.ts`** (new) — one Dexie transaction clearing and rebuilding every table from the backup. Deliberately REPLACE, not merge: merge semantics (colliding ids, half-updated learned pools) are unpredictable exactly when Deepak is least able to verify them — mid-disaster-recovery, under time pressure — while replace is the one semantics whose outcome is fully predictable before confirming it. The one carve-out: this device's own API keys are read before `settings` is cleared and re-inserted after, so a restore never wipes credentials the backup never claimed to know about. After the transaction commits, re-arms the device outside it — alarms for every imported planned/running future departure, both materializers, widgets, the day gauge — each step independently try/caught, since imported rows carry no OS-level alarms until something schedules them fresh on THIS phone.
  - **`src/native/backupFile.ts`** (new) — native: `@capacitor/filesystem` writes the JSON to `Directory.Cache`, then `@capacitor/share` hands it to whatever the phone offers (Drive, Gmail, My Files). Web: a plain `Blob` + anchor download, for the Mac/dev usage path. Filename `runway-backup-{YYYY-MM-DD}.json`, local calendar date.
  - **Settings gained a "Backup" section**: "Last backup: {date} {time}" (or "Never backed up."), an Export/Import button pair, and the caption *"Everything Runway has learned, as one file. API keys are not included — they stay on this device."* Import reads a hidden `<input type="file">` (no new plugin needed for reading), parses and validates the file, then a native `confirm()` — *"Replace everything in Runway with this backup from {date}? Current data on this phone is erased."* — before anything is written. `lastBackupAt` is written only after a successful export, never speculatively.
  - Two new plugins: `@capacitor/filesystem` and `@capacitor/share`. `npx cap sync android` run clean — 7 npm-packaged plugins registered (up from 5), no Java touched this release.
  - 12 new tests (`src/lib/backup.test.ts`): round-trip fidelity, secret exclusion, every rejection reason, older-schema acceptance, newer-schema rejection, filename formatting.

## 0.31.0
- **Day gauge — the Maps hack, generalized to the whole day.** Runway's origin story is a live countdown that was AMBIENT — glanceable in the notification shade without opening an app, the same way Google Maps' navigation notification is glanceable while getting ready. That idea has only ever applied to the walk out the door. This release generalizes it to the whole day: an optional, silent, persistent notification showing the next commitment — a departure, a task with a deadline, an exam study block, whichever is soonest — and a LIVE, ticking countdown to it. The gap between commitments is exactly where "just five minutes" becomes forty; this puts the distance to whatever's next permanently in view, not just during the getting-ready window.
  - **`src/lib/dayGauge.ts`** (new, pure) — `nextCommitment(now, departures, tasks, exam)` picks the single soonest FUTURE candidate across three pools: every planned/running departure's `leaveBy` (reused verbatim from `computeProjection`, never re-derived), every planned/running task's `deadlineAt`, and the exam's next study-block occurrence (`occurrenceDates`, reused verbatim from `recurrence.ts`). Returns `null` when nothing qualifies.
  - **`android/.../DayGaugePlugin.java`** (new) — the native half, and the load-bearing architectural choice: NO foreground service, NO periodic JS timer. `NotificationCompat.setUsesChronometer(true)` + `setChronometerCountDown(true)` + `setWhen(targetAtMs)` hands the live mm:ss countdown entirely to Android's own renderer — the app only calls `show()` again when the TARGET changes, not on any tick. Own silent channel (`runway-gauge`, `IMPORTANCE_LOW`, no sound, no vibration) — deliberately separate from the alert channels `notifications.ts` already owns, since this is a gauge to glance at, not an alert to react to.
  - **The one honest tradeoff, stated plainly rather than glossed over**: the chronometer has no awareness of "target reached" — if it passes while the app stays fully closed, the notification goes stale (counting up past zero, or negative) until the app is next opened and re-points it. This is the same staleness shape the home-screen widgets already accept, just without their ~6-hourly OS-driven self-heal, which is why `refreshDayGauge()` also runs on `visibilitychange` → visible (App.tsx), not only at the same write sites the widgets refresh from.
  - **Opt-in, off by default** (`dayGaugeEnabled` setting, absent/`'false'` = off) — CLAUDE.md's "defaults lean toward less" rule; a silent ongoing notification is a bigger, more permanent footprint on the shade than any alert Runway already posts. Settings gained a "Day gauge" section with the toggle and its caption, verbatim: *"A silent, persistent notification counting down to your next commitment. Updates when you open Runway or anything changes."*
  - **`refreshDayGauge()`** (`src/lib/dayGaugeRefresh.ts`) is paired with every one of `refreshWidgets`' 23 existing call sites — "anything that moves the widgets moves the gauge," since every candidate the gauge reads is already exactly what the widget snapshot's own queries already read. Never throws, same fire-and-forget contract as `refreshWidgets`/the materializers.
  - Device-verify caveat, same class as this app's other native-first features: whether the chronometer renders correctly inside a heavily-skinned One UI (Samsung) notification specifically is UNVERIFIED as of this release.
  - `npx cap sync android` run and clean. DayGauge is this app's fourth custom (non-npm) plugin, registered in `MainActivity` alongside WidgetBridge/CalendarBridge/WifiBridge — `cap sync`'s own plugin count (5, unchanged) only reports npm-packaged plugins, since a manually-registered custom plugin isn't something `cap sync` discovers or needs to act on.

## 0.30.0
- **Guess-then-see — closing the loop on the one trainable piece of time blindness.** Time blindness itself isn't fixable; estimation ACCURACY is, but only with feedback — and until this release, Runway never told Deepak how his own guesses compared to what actually happened. It prefilled learned times, it showed medians and slip trends, but a guess he typed himself vanished into the same pool as a number the app suggested, with no record of which was which and no moment where the outcome came back to him.
  - **`estimateSource?: 'manual' | 'learned'`** (`DepartureStep`, `StepTemplate`, `TaskUnit` — `src/db/types.ts`) — provenance on every planned-minutes value: 'manual' for Deepak's own felt guess, 'learned' for a value the autocomplete/auto-learn/a suggestion card applied and he never subsequently hand-edited. `undefined` on every row written before this field existed — deliberately NOT this app's usual undefined-as-null convention: auto-learn has existed since the learning increment, long before this field did, so an unknown share of legacy history is actually learned, not felt. Collapsing undefined to 'manual' would poison the exact signal this field exists to keep clean, so it's excluded from the bias ledger instead — the ledger builds forward from here, not backward into guessed legacy provenance.
  - Set at every write site of a step's minutes: TaskSetup's autocomplete apply vs. hand-edit, DepartureSetup/TemplateEdit's per-step autocomplete apply vs. hand-edit (prep steps and arrival steps both), autoLearn.ts's write-itself update, and Home's suggestion-card Apply (a write site the original spec missed — found while tracing every `plannedMinutes`/`minutes` write in the codebase). Carried through verbatim on every wholesale copy, in both directions: materialize.ts's `buildDeparture`, DepartureSetup's "New from template" and "Save with repeat" (which builds a fresh Template from a Departure's steps), and TemplateEdit's "Make repeating" promotion — a copied step has the same provenance as its source.
  - **`src/lib/estimateBias.ts`** (new, pure, Dexie-free) — `guessPairs(departures, tasks)` pairs every MANUAL-provenance step/unit's planned minutes with its derived actual, over the exact same natural-run eligibility `naturalActualsByStepName` already enforces (no replanned runs, no batched retroactive check-offs — `learning.ts` now exports `naturalDepartures`/`naturalTasks` so both files share one definition instead of two that could drift). `biasFromPairs` reduces a name's pairs to the median `actual/guessed` ratio, null under a 5-pair evidence floor (Learning.tsx's per-name cards call it with a looser 3-pair floor instead — a narrower, per-name claim earns a real answer sooner than the headline "how do you guess in general" number does). `globalBias` flattens every name into one ratio at the conservative default floor.
  - **TaskRun's done summary** gained one line, shown only when EVERY unit of the finished task was a felt guess (never for a learned or unknown-provenance unit — feedback on a number Deepak didn't choose himself trains nothing): "Guessed N min. Took M min." Plain slate, tabular numbers, no color coding — this is a measurement Runway is handing back, not a verdict on how the guess went. CLAUDE.md's no-shame rule is binding here the same way it is everywhere else feedback touches a number Deepak typed.
  - **Learning screen** gained a "Your guesses" section, above "Steps and tasks": "Across N guessed runs, your guesses run X% short/long," or "...are accurate" within ±10%. Per-name cards that clear their own (looser) evidence floor gained a second line: "Guessed X min → typically Y min." The Departures section gained a slip-TREND line under the existing all-time median — **`slipTrend`** (new, `src/lib/calibration.ts`) compares the median slip of Deepak's earliest departures against his latest (window capped at 10, non-overlapping, null under 6 total departures), so "your guesses run short" has a second line answering "is that changing" right next to it. Requires its input in strict chronological (oldest-first) order — the opposite of History.tsx's own most-recent-first ordering, called out explicitly in the doc comment since reusing History's own sort would silently swap "earliest" and "latest."
  - No Dexie version bump (every field above is a non-indexed addition to an existing table, same treatment as `Template.schedule`/`Departure.wasReplanned`), no native change, no cap sync needed.

## 0.29.0
- **Learning — the window onto what Runway has learned.** Field request: "it would be nice to have a UI to see what the app learns about me." Runway has always learned silently — P75 step estimates from natural runs, P25 rushed-compression floors, out-the-door slip medians, measured Prüfung pace — but none of it was visible anywhere except indirectly, as a prefilled number or a suggestion card. This screen makes it a first-class, readable fact.
  - **`learningReport(departures, tasks)`** (`src/lib/learning.ts`) — one row per step/task name the app has learned something about: the UNION of `naturalActualsByStepName`'s keys and `rushedActualsByStepName`'s keys, so a step that's only ever been run compressed (never once naturally) still earns a row for its rushed floor, rather than being dropped for having a 0 natural-run count. Deliberately narrower than `stepNameLibrary` — that function also lists never-run template names (its job is autocomplete, "you've called this before"); this one reports what's actually been LEARNED, so a template-only name with zero runs of any kind gets no row here. Sorted by run count descending, then name ascending — a deterministic tiebreak `stepNameLibrary`'s own Set-insertion-order tiebreak doesn't need but this screen's stable rendering does.
  - **`src/screens/Learning.tsx`** — three sections, each only rendered when there's something to show: "Steps and tasks" (one card per report entry — the learned P75 estimate with its P25–P90 spread and run count, or "N runs recorded. A learned time needs 3." below the floor, or "Only rushed runs so far..." for the rushed-only case; a rushed-compression floor gets its own line when known), "Departures" (the same median-slip computation History.tsx already shows, but over ALL eligible departures rather than History's last-10 window — History answers "how am I doing lately", this screen answers "what has the app learned over all of history", and those are legitimately different numbers), and "Prüfung" (the measured pace only — never the labeled 4 h/week default, since that default is a stated assumption, not something learned). All three, and the whole screen, stay silent rather than show a hedge when there's nothing to report.
  - Reached from a new "What Runway has learned" TextAction at the foot of History, not from Home directly — History is the raw record, Learning is its distillation, one level down from the log it summarizes rather than a peer destination competing for space on Home.

## 0.28.3
- **Android back gesture — the field bug behind this release.** Field report: "navigating with swipe doesn't work." Navigation in this app is plain React state (App.tsx's own Screen union), not the browser's History API, so there's no WebView back-stack for Android's back gesture to walk. Nothing listened for Capacitor's `backButton` event, so Capacitor's own default kicked in: finish the Activity. A back swipe (or the hardware/3-button back) exited the app instead of going back one screen.
  - **`src/lib/backTarget.ts`** — a pure function mapping every `Screen` to the exact destination its own on-screen back chevron already uses, verified against each screen's `ScreenHeader onBack` (or, for `report`, its own local `backTarget`) rather than re-derived. Exhaustive switch, no `default` — the same never-trick `NEXT_MOVE_REASON_LINE` (ExamOverview.tsx) already relies on, so a future `Screen` variant that's missing a mapping here fails to *compile*, not just to navigate correctly. `null` means "at the root" (home only).
  - **`src/lib/backOverride.ts`** — a small module-level stack so an open overlay (StepFocus, BackdateDialog) can claim a back gesture for itself instead of it navigating the screen underneath. `pushBackOverride(handler)` registers and returns an unregister function that removes that exact handler by identity; `consumeBackOverride()` calls the top-most registered handler (if any) and reports whether one was there — it does NOT auto-unregister, since the overlay itself decides when it's actually closed. Wired into Runway.tsx's and TaskRun.tsx's StepFocus (`focusStepId`/`focusUnitId` effects) and into `BackdateDialog.tsx` directly (one component, every "Done earlier"/"Left earlier"/"Arrived earlier" call site covered at once).
  - **`src/native/backGesture.ts`** — the native listener: registering ANY `backButton` handler is what disables Capacitor's default close-the-activity behaviour, so this file's existence, not what it computes, is the load-bearing fix. Checks the override stack first; otherwise computes `backTarget` and navigates, or — at the root — calls `App.minimizeApp()`, deliberately NOT `exitApp()`: Android 12+'s own predictive-back already backgrounds a rootless task rather than killing it, and exiting would also tear down the JS side keeping a live projection's countdown warm. Registered from a mount effect in App.tsx, StrictMode-double-invoke safe, the same unsubscribe shape `registerNotificationNavigation`/`registerDeepLinkNavigation` already use.
  - Device-verify caveat, same class as `notifications.ts`'s existing cold-start notes: whether a gesture-nav swipe and the classic 3-button back deliver `backButton` identically, and whether StepFocus's immersive overlay still lets the OS deliver the event at all, are both UNVERIFIED until tried on the physical device.
  - `src/native/deepLinks.ts`'s header comment updated — it's no longer the only file importing `@capacitor/app`; `backGesture.ts` is the second, on a disjoint part of the plugin's surface (`backButton`/`minimizeApp`, not `appUrlOpen`/`getLaunchUrl`).

## 0.28.2
- **"New task" got the same standing as "New departure."** A field request: departures and tasks are peer entry points now, but "New task" was a quiet header TextAction while "New departure" was the screen's one full-width primary button — a second-class visual for something that isn't second-class. Home's top of the primary section is now a two-up row, both buttons PRIMARY, side by side. This is a deliberate design-system exception (Button.tsx's own comment calls primary "the one action per screen that matters"); the Tasks section header dropped its now-redundant duplicate "New task" action rather than keep two ways to reach the same screen a few lines apart.

## 0.28.1
- **A finished task used to vanish without trace — the field bug behind this release.** Live report: a first 60-minute task overshot its deadline, every unit got checked off, the done summary showed, and then — nothing. Home only ever lists `planned`/`running` tasks (by design, see 0.25.0's own note that "recently-done tasks are NOT listed anywhere on Home"), and History's query has always been departures-only ("No departures yet." is its literal empty state). The task row was intact in Dexie the entire time, `status: 'done'`, with nothing wrong in the data — there was simply no screen left that ever queried for it again.
  - **Two new pure helpers** (`src/lib/taskProjection.ts`): `taskFinishedAt` (the MAX `checkedAt` across a task's units — `null` for a task with no checked units, deliberately never falling back to `createdAt` inside the helper itself) and `taskDeadlineResult` (`'met'`/`'overshot'` plus whole minutes, `null` when there's no deadline or no finish time to measure). The two roundings go opposite directions on purpose: `'met'` floors (an honest lower bound on the margin), `'overshot'` ceils (a 30-second miss still reads "1 min past", never a forgiving "0 min past").
  - **History gained a "Tasks" section**, below the existing departures list, unrendered (no empty-state line) until there's at least one `done`/`abandoned` task — CLAUDE.md's "defaults lean toward less, not more". Each row: name, finished date, "N units · M min." (same figure the done summary already showed), and a result label — `on time`, `past deadline +N min`, `—` for a done task with no deadline, `abandoned`.
  - **TaskRun's done summary** gained one line under the existing units/minutes line, present only when `taskDeadlineResult` returns non-null: "Finished N min before the deadline.", "Finished on the deadline.", or "Finished N min past the deadline." in red. The plainly-stated fact is the whole feature — no consolation copy for an overshoot.
  - **TaskSetup's autocomplete caption** was separately imprecise: selecting a remembered name with 1–2 recorded runs (below `learnedEstimate`'s 3-sample evidence floor) rendered "learned · 1 runs" — wrong on both the word ("learned" implies a minutes value was applied; under 3 samples none was) and the plural. Now reads "N run(s) recorded. A learned time needs 3." for that case, and unchanged "learned · N runs" once N ≥ 3.

## 0.28.0
- **Study blocks — the "armed vs. spontaneous" fix.** The structural insight behind this rework: a departure works because it's ARMED — scheduled, alarmed, materialized a week ahead, exactly like every other departure. Study time had none of that; it relied on a spontaneous, in-the-moment decision to open the app and start a sprint, and that is exactly the kind of decision ADHD declines to make reliably. This fix gives study time the same standing footing a departure already has: an exam can now carry a repeating schedule, and the schedule materializes into real, exact alarms — not a softer nudge, not a fake urgency machine. Deepak picking "Tuesday 19:00" here is a real, chosen commitment with the same legitimacy as picking a departure's appointment time.
  - **`Exam.studySchedule`** (`{ time, days, minutes }`, `src/db/types.ts`) — a non-indexed addition, no Dexie version bump, same undefined-as-null discipline as every other late-added field on this app's rows. `minutes` is the fixed sprint length (25/50/90) the schedule commits to, alongside the usual "HH:mm" + Monday-first `days` shape `TemplateSchedule` already uses.
  - **No new table, and that's the design, not a gap.** A study block is materialized as a scheduled NOTIFICATION only — there is no `studyBlocks` row per occurrence. A block that's never started should vanish without trace: the weekly hours bar on ExamOverview is already the honest record of what actually happened, and a ledger of skipped blocks would only build a guilt list nothing asked for. A block that IS started becomes a real `Sprint` through the ordinary SprintSetup flow, which stays the only record this app keeps of study time.
  - **`scheduleStudyBlockAlarms`/`cancelStudyBlockAlarms`** (`src/native/notifications.ts`): reuses `occurrenceDates` (`src/lib/recurrence.ts`) verbatim for the same 7-day materialization horizon departures already use, and the same STAGED notification channel and snooze action type ("+10 min") a departure's "Start getting ready" alarm gets — a study block accepts the same "not yet, ten more minutes" as legitimately as any other alarm in this app. Each occurrence's id is deterministic — `notificationId(`study-${examId}-${date}`, 0)`, the same string-namespaced reuse pattern `sprintNotificationId`/`milestoneNotificationId` already established, no new numeric id range. Cancellation deliberately walks a WIDER 14-day plain-calendar-date window (`calendarDates`, new in recurrence.ts) rather than the schedule's own 7-day occurrence list — a day just removed from the schedule has no schedule object left behind that could tell a fresh cancel pass which date to clear, so cancellation over-covers by date instead of under-covering by trusting the current schedule.
  - **Tap-to-sprint**: tapping a study-block alarm opens SprintSetup with a new `autoSuggest` prefill (`src/lib/nextMove.ts`'s `autoSuggestSelection`) — the same topic `nextMove` would already suggest on the exam overview, but with the schedule's own chosen length (not a momentum-derived guess) preselected. The start ritual still applies; a scheduled alarm removes the "which topic, how long" decisions, never the ignition ritual itself.
  - **ExamSetup** gained a "Study blocks" section — the existing `RepeatEditor` (now with overridable label/footer text, since its defaults were written for departures) plus a length picker matching SprintSetup's own chip style. **ExamOverview** gained one quiet line under the weekly bar ("Study blocks: Tue, Thu · 19:00 · 50 min.") when a schedule is set — visibility of the commitment, deliberately no per-block list, since blocks are alarms, not entities.
  - **Materializer wiring**: `materializeStudyBlockAlarms` (`src/lib/materialize.ts`) re-runs on every app open (after the existing departure materializer) and after every ExamSetup save — same "open Runway at least once a week to keep alarms armed" honest limitation the departure materializer already states, now true of study blocks too.

## 0.27.0
- **Empty-exam honesty — the vacuous-done bug.** A field screenshot showed the actual bug: an exam with ZERO topics rendered the exam overview's huge centerpiece as "Ready by 10 Jul" (today) with an emerald "All topics at their estimated hours." underneath — a confident, fully-finished-looking screen for an exam that had nothing in it yet. The cause: `remainingHours(topics, sprints)` sums to 0 over an empty topic list (or a list where every topic reads 0 estimated hours) exactly the same way it does once real topics are genuinely finished, and `examProjection`'s `remaining === 0` branch couldn't tell the two apart.
  - **New `'empty'` state** (`src/lib/examProjection.ts`), checked before the `'done'` branch and shared by `examProjection` and `milestoneProjection` alike: `readyDate`/`slackDays`/`requiredPaceHoursPerWeek` are all `null`, distinct from `'done'`, which now means real topics, with real hour estimates, actually covered.
  - **ExamOverview** renders `'empty'` as a plain-slate "No topics yet." (no huge-date treatment) with the sub-line "The projection starts when the exam has topics with hour estimates." — the actionable pace line, pace assumption, and new weekly bar (below) are all omitted rather than showing a technically-true-but-pointless line. The primary action switches from "Start a sprint" to "Edit topics"; the next-move/guided cards already stayed hidden for this case via `nextMove()`'s own no-topics guard, verified rather than reimplemented.
  - **The Prüfung widget** got the same fix: `widgetSnapshot.ts` gained a distinct `emptyExam` boolean (kept separate from `neverReady` — a vacuous exam and a zero-measured-pace exam are different facts), and `PruefungWidgetProvider.java` renders a "No topics yet." line for it, same shape as the existing "No exam set up." fallback. Old snapshots without the field parse it as `false` via `optBoolean` — org.json tolerates the missing key, and the next app open overwrites the snapshot with the current schema.
- **Weekly tactical surface.** Below the actionable pace line, a thin progress bar (the only progress bar in this app — topic coverage stays plain numbers, per the existing "a bar at 8% is demoralising" rule; a week bar is a different shape of fact, since it fills across days and resets every Monday rather than accumulating into a months-long standing low-percentage read) shows this week's logged hours against the required weekly pace, turning emerald once the target's met. Below that, a new quiet line — "Best week: N h." — reports the best-ever complete Monday-start week of logged hours (`bestWeekHours`, `src/lib/examProjection.ts`), a self-Competitor fact (CLAUDE.md's secondary play personality), never a comparison to anyone else and never a streak.
- **Topics as chapters.** A topic row whose logged hours reach its estimate now turns emerald-300 with a trailing "· complete" — still no bar, no percentage (that ban stands for topic rows), just a colour and a word on the same plain number.
- **Milestones' empty state got exact copy**: "No milestones yet. A booked mock oral is the strongest deadline this app can render." — stating plainly that this section renders real external dates, it doesn't invent them, rather than nagging toward adding one.

## 0.26.0
- **Backdating — explicit, bounded corrections for a forgotten tap.** The field question behind this one: a step checked off 25 minutes late used to teach the learner a false 40-minute shower, and a forgotten "I'm out the door" tap used to corrupt that whole morning's slip record — because the only timestamp ever available was `now`, whenever `now` happened to be. Three binding principles shaped the fix: the hot path stays ONE tap, never a picker, in the normal flow; a correction is bounded — it can't describe an impossible timeline, always somewhere between the previous real event and the present moment; and **the app never backdates on its own** — every corrected timestamp is a deliberate, explicit choice, which makes it better data than the auto-`now` it replaces, not worse.
  - **New pure helper**, `src/lib/backdate.ts`: `clampBackdate(chosen, lowerBound, now)` validates a chosen instant against `[lowerBound, now]` inclusive on both ends (simultaneous with the previous event is a real timeline; "just now" is not backdating) and reports which honest "no" applies otherwise (`before-previous` / `in-future`). `hhmmToDateNear(hhmm, reference)` turns an `<input type="time">` value into the nearest PAST occurrence of that clock time — the deliberate mirror of `nextOccurrenceOf` (`src/lib/nextOccurrence.ts`), which rolls forward for a target still ahead; a correction always looks backward instead.
  - **New shared UI piece**, `src/ui/BackdateDialog.tsx`: a small inline panel — never a modal, matching the replan/re-anchor confirmation blocks Runway.tsx already uses — with a captioned time field defaulting to now, a live validation line in the exact copy `clampBackdate`'s reasons drive ("That's before the previous event (HH:mm)." / "That's in the future."), and Confirm/Cancel.
  - **Five wiring points, one per place a forgotten tap is actually discovered**: the current-step card on the live Runway screen (prep AND arrival phases) gets a quiet "Done earlier" under the elapsed line — current step only, since a later step hasn't started yet and can't have finished "earlier" by definition; StepFocus gets the same action beside the back chevron, excluded from the whole-screen tap-to-check zone, which closes the overlay and reopens the dialog on the card underneath it; the leave block gets "Left earlier" beside "I'm out the door"; the arrival gate gets "Arrived earlier" beside "I'm at the building"; TaskRun's current-unit card gets the same "Done earlier" as the departure step card, and a backdated last unit still auto-resolves the task to `done` with the corrected time driving the summary. Every one of these renders only once the run in question has actually started (`startedAt`/`arrivedAt`/`leftAt` already set) — there's no "backdate something that was never running" case to handle.
  - **Learning stays correct with zero learning-code changes**: corrected timestamps flow through `deriveStepActuals`/`deriveTaskUnitActuals` exactly like any other `checkedAt`. `isBatchedRun` (`src/lib/learning.ts`) gained a comment, not a guard change — a single deliberate backdate is the user's considered best truth and is meant to count, while the retroactive-catch-up pattern (three-plus check-offs landing in the same real-time minute) it exists to filter stays filtered; the two are complementary, not in tension.
  - **Post-hoc completeness was already reachable and stays so**: a departure stuck `running` hours after the fact (Home's "Past departure time" section → Open) now has an honest way to close out truthfully via these same actions, rather than either staying open forever or getting a silently-wrong `now`.

## 0.25.0
- **Tasks — timed work without travel.** The field report behind this one: "befunden 5 EEGs, ~15 min each, before the 16:00 Übergabe" has the same time-blindness problem a departure does, but no vehicle, no destination, no keys-and-toilet friction to buffer for. A Task (new Dexie v5 table) is the departure model with travel/buffer/arrival/destination removed — a name, N identical units, minutes per unit, an optional deadline — running on the exact same live-projection, per-unit check-off, step-focus and name-keyed learning machinery a departure's steps already use, not a parallel implementation.
  - **New screens**: `TaskSetup.tsx` (create-only; name via the same `StepNameAutocomplete` departures use, unit count up to 50, minutes per unit, an optional `<input type="time">` deadline with next-occurrence rolling) and `TaskRun.tsx` (the live screen — centerpiece projected finish, state-colored once a deadline is set, plain slate when there isn't one; a deadline's slack line; unit rows with the same two-target checkbox/tap-to-focus shape Runway's steps use; Start; auto-resolves to `done` on the last unit checked, no separate "I'm out the door" tap the way a departure needs one).
  - **Two binding, deliberate cuts — both are honest limitations, not oversights**: no plan compression (a unit of clinical work can't be squeezed the way a shower can — the only real lever under time pressure is *which* remaining units still fit, surfaced as the exact line "N of M remaining units fit before HH:mm" once a deadline can't cover all of them) and no scheduled notifications (a task starts deliberately, at a desk, with the live screen already open — there's no "wake me up to start getting ready" moment the way there is before leaving somewhere; the live screen is the whole instrument).
  - **Reuse, not reimplementation**: `deriveTaskUnitActuals` (`src/lib/taskProjection.ts`) calls calibration.ts's `deriveStepActuals` verbatim against a `{ steps: task.units, ... }`-shaped object — zero new chain-attribution math — because `TaskUnit` is field-for-field identical to `DepartureStep` by design. `StepFocus.tsx` is reused as-is by the same structural-typing trick, with exactly one generalization: its `bottomLine` prop became optional, for a task with no deadline to honestly show nothing at. `currentStepAnchor`/`currentStepElapsed`/`isBatchedRun` are all called unmodified against task-shaped objects too. `nextOccurrenceOf` (Runway.tsx's re-anchor panel) moved to a shared `src/lib/nextOccurrence.ts` so TaskSetup's deadline field uses the identical rolling-time logic.
  - **Learning joins by name, across both worlds**: `naturalActualsByStepName` and `stepNameLibrary` (`src/lib/learning.ts`) both gained an optional `tasks` parameter (default `[]`, every pre-existing call site unaffected) — a done task's unit actuals pool into the exact same name-keyed history a departure step of the same name feeds, recency-capped to 14 occurrences *combined* across both sources, not 14 of each. There is no task equivalent of the rushed/compressed pool — tasks have no compression at all, so every eligible task run is natural, full stop.
  - **Home** gained a "Tasks" section (between Quick capture and Waiting on arrival) — up to 3 in-progress tasks, "+N more", each showing progress ("N of M units") and either a deadline slack line or a plain finish time. Recently-done tasks are NOT listed anywhere on Home; History stays departures-only in v1 — a natural v1.5 extension, not built here.

## 0.24.0
- **Recurring calendar events, and two ways to promote a one-off departure into one** (field report #10: a weekly calendar event, "Fortbildung" every Friday, was offered by the calendar section but Runway neither understood it was recurring nor offered any way to make the resulting departure repeat). Binding design decision behind this whole fix: ONE recurrence engine — Templates — never a second scheduler bolted onto a Departure.
  - **Calendar recurrence awareness**: `CalendarBridgePlugin.java` now reads the joined `Events.RRULE` column defensively (a missing/unreadable column resolves to `null`, never a crash) and returns it per event. New pure `src/lib/rrule.ts`'s `parseWeeklyRrule` recognizes a plain `FREQ=WEEKLY` rule with an explicit `BYDAY` list and at most `INTERVAL=1` — the only shape this app's own once-a-week `TemplateSchedule` model can represent; anything else (a different FREQ, `INTERVAL>1`, no `BYDAY`, an unparseable string) is an honest `null`, not a guess. Home's "From your calendar" cards now show a faint "Repeats Mon–Fri in your calendar." line when it parses.
  - **Repeat at departure creation**: DepartureSetup's create flow gained a Repeat section — the same toggle/time/day-chip control TemplateEdit already had, now extracted into a shared `src/ui/RepeatEditor.tsx` so there's one control, not two drifting copies. Defaults to the appointment's own time and weekday; pre-enabled with the parsed days when the form was reached via "Plan departure" on a recognized recurring calendar event. Saving with Repeat on creates a Template from the form and links today's departure to it (`templateId` + `scheduledForDate` = its own date) — this is what makes the materializer's existing dedup key already cover the occurrence just saved, so the rest-of-week materialize pass that follows can never double-book it, even when the appointment's weekday isn't among the chosen repeat days.
  - **"Make repeating"**: a quiet TextAction on any planned, template-less departure card (Home) opens TemplateEdit prefilled from that departure — name, destination, steps, arrival steps, Wi-Fi SSID — with Repeat pre-enabled from its own appointment. Saving links the source departure back to the new template (same dedup-safe `scheduledForDate` link as above) transactionally, whether or not Repeat ended up staying on — a template is a useful thing to have created either way.
  - **Deferred, stated honestly**: calendar sync when an event moves or is cancelled after planning is not built — see README's "Calendar and sharing" section and v1.5 list.

## 0.23.0
- **Automatic arrival**: the "I'm at the building" tap (0.21.0's arrival
  steps) now has two ways to happen without a tap at all, alongside the
  manual button, which stays as the fallback for both.
  - **Wi-Fi arrival detection**: a Template (and a Departure copied from
    one) can carry an optional "Arrival Wi-Fi network" SSID, shown only
    once its arrival-steps section is non-empty
    (`src/screens/TemplateEdit.tsx`, `src/screens/DepartureSetup.tsx`). New
    `WifiBridgePlugin.java` reads the phone's currently-connected SSID via
    the deprecated-but-functional `WifiManager#getConnectionInfo()` — kept
    deliberately conservative rather than migrated to the
    `ConnectivityManager.NetworkCallback` replacement, which is built for a
    long-lived listener, not the one-shot read this needs (see the
    plugin's own doc comment). Permission-gated on `ACCESS_FINE_LOCATION`
    (the alias is `"location"`, mirroring `CalendarBridgePlugin`) — Android
    requires it to resolve a real SSID rather than the redacted
    `<unknown ssid>` placeholder; most users will already have granted it
    via the live-travel feature. `Runway.tsx`'s journey phase polls
    `src/native/wifi.ts`'s `getCurrentSsid()` on mount and on
    `visibilitychange`, and stamps `arrivedAt` with the exact same write
    the manual button uses on a case-insensitive match.
  - **`runway://arrived` deep link**: routes Deepak's own Samsung Modes &
    Routines hospital-arrival automation into the app — see README's new
    "Automatic arrival" section for the exact setup steps. New
    `src/lib/externalArrival.ts` finds the one `'left'` departure (arrival
    steps present, not yet arrived, appointment within ±12 h of now — a
    zombie-departure guard, since the routine fires on every real arrival,
    not just ones with a Runway departure in flight) and stamps it,
    landing on that departure's Runway screen; zero matches lands on Home,
    silently — the routine fires on ordinary shifts with no departure
    planned too, and a toast on every one of those would be pure noise.
    The match-selection logic is a pure, unit-tested function,
    `selectArrivalCandidate`. `src/native/deepLinks.ts`'s existing
    cold-start dedupe (`lastHandledUrl`) can't be reused here — every
    delivery of this link is the literal same URL string, so reusing it
    would permanently block every arrival after the first. A separate,
    self-clearing in-flight guard handles only the real risk (the same
    cold start delivered twice, once via each of `appUrlOpen` and
    `getLaunchUrl()`) without blocking a genuinely later arrival.

## 0.22.0
- **Landscape step focus**: the manifest never locked orientation (Capacitor's
  Android default, `sensor`, was already in effect — confirmed by reading
  `android/app/src/main/AndroidManifest.xml`, which has no
  `android:screenOrientation` on `MainActivity`), so this is a pure CSS
  change, no manifest edit. `src/screens/StepFocus.tsx`'s countdown digits
  grow to `landscape:text-[11rem]` in landscape — computed against the
  worst-case "+88:88" string (6 tabular-nums characters) and the S25
  Ultra's 915px landscape width, staying well inside a ~92vw ceiling (see
  the arithmetic comment in the component). The step-name and leave-by
  lines pin to the true top/bottom of the rotated viewport
  (`landscape:absolute` + the existing `safe-top`/`safe-bottom` spacing
  tokens) instead of clustering around the digits, freeing the vertical
  middle for the digits alone on a 412px-tall landscape viewport. The
  overrun fill (rises from the bottom) is orientation-agnostic and
  unchanged. The rest of the app was screenshot-checked in landscape and
  needed no changes — its `max-w-lg` centered columns already behave.
- **Custom audio cues**: the "getting ready" and "leave now" alarm channels
  ring distinct, purpose-made chimes instead of sharing Android's default
  notification sound — a gentle two-tone rise (660→880 Hz) for the three
  staged alerts, a firmer three-note rise (660→880→1100 Hz) for "leave now"
  and the sprint/exam-timer end alarm. Generated by the new, committed
  `scripts/generate-chimes.py` (stdlib `wave`+`math` only) into
  `android/app/src/main/res/raw/runway_{staged,leave}.wav`. **A notification
  channel's sound is fixed at creation and can't be changed afterwards on
  Android** (confirmed against the plugin's own Android source,
  `NotificationChannelManager.createChannel` — `setSound()` is only called
  there, never again), so attaching the new chimes required moving to
  versioned channel ids: `runway-staged-2` / `runway-leave-2`,
  `src/native/notifications.ts`. `ensureChannels()` now also deletes the two
  old channel ids (`deleteChannel` is exposed by this plugin) so they don't
  linger as orphaned, silent entries in Android Settings. **Anyone who had
  customized the old channels' sound or vibration in system Settings loses
  that customization once**, on this update — a one-time reset, not a
  recurring cost, and named here rather than left to be discovered by
  surprise.

## 0.21.0
- **Arrival steps**: the field insight behind this release is that "on
  time" was never really the hospital door — it's the ward station, AFTER
  changing into scrubs and taking the lift. `appointmentAt` has always been
  the true target this app is built around; what was missing was a way to
  say that travel doesn't end at the building, for the appointments where
  it genuinely doesn't. A Template (and a Departure copied from one, or
  built from scratch) can now carry an optional second list — arrival
  steps — that live after travel and before the true target.
  - `src/db/types.ts`: `Template.arrivalSteps` and `Departure.arrivalSteps`
    (both `StepTemplate[]`/`DepartureStep[]`, empty by default, same
    undefined-as-null treatment as every other late-added field on these
    rows — no Dexie version bump needed). `Departure.arrivedAt` is new too:
    stamped by an explicit "I'm at the building" tap, never inferred — see
    that field's own doc comment for why a guess would misattribute the
    whole journey onto the first arrival step's timer.
  - **The equation gains a term** (`src/lib/projection.ts`): projected
    arrival now adds remaining (unchecked) arrival-step minutes on top of
    remaining prep, buffer, and travel; leaveBy subtracts them too (also
    "remaining", not "total" — before departure none are checked, so the
    two are identical, but this keeps leaveBy honest if it's ever
    evaluated again mid-arrival-phase). `computeStartBy` and
    `computeAlarmTimes` (`src/lib/alarmTimes.ts`) use the FULL arrival
    total instead, since both are computed once, before any step of
    either kind exists to check off — a departure with arrival steps now
    shows an earlier "start getting ready" and all four staged alarms
    fire earlier, automatically. A departure with none is completely
    unaffected — the new term is always `0` for it, by construction.
  - **Runway screen**: once a departure with arrival steps reaches
    status `'left'`, it gets a live arrival phase instead of the old
    plain "Logged ... Safe travels." note — the same live centerpiece
    (projection vs. the true appointment), gated behind an explicit "I'm
    at the building" tap, then the arrival-steps checklist (same
    check-off mechanics as prep, including step-focus tap-through).
    Checking the LAST arrival step resolves the departure automatically —
    status `'done'`, `arrivalResult` derived from the exact checked-off
    timestamp against the appointment — the most precise arrival capture
    this app has ever produced, no guess required. A departure without
    arrival steps behaves exactly as before.
  - **Calibration** (`src/lib/calibration.ts`): `deriveStepActuals` now
    reconstructs TWO independent chains — prep, anchored at `startedAt`
    (unchanged), and arrival, anchored at `arrivedAt` — never one
    continuous chain. The gap between "last prep step checked" and
    "arrived at the building" is the journey itself; attributing it to
    the first arrival step would teach the learner that changing into
    scrubs takes forty minutes when thirty-eight of those were spent
    driving. A departure whose arrival phase never began contributes no
    arrival actuals at all. Auto-learn (`src/lib/autoLearn.ts`) and the
    task-memory autocomplete (`stepNameLibrary`) treat arrival steps as
    steps; Home's suggest-and-confirm cards stay prep-only for now (see
    that function's own doc comment — a narrower scope than it could
    have, flagged as a v1.5 candidate, not a final decision).
  - **Home**: a departure with arrival steps is excluded from "Waiting on
    arrival" while it's still `'left'` — it resolves itself, more
    precisely, from the Runway screen's own arrival phase; offering the
    same departure there too would let a manual Early/On time/Late tap
    short-circuit that more honest capture. Judgment call, flagged rather
    than silent — see `src/screens/Home.tsx`'s own comment.
  - TemplateEdit and DepartureSetup both gain an "Arrival steps" section
    below the existing step list — same row UI (reorder in TemplateEdit,
    autocomplete in both), optional and empty by default.

## 0.20.0
- **Learning**: Runway now learns realistic per-step and buffer times from
  lived data, instead of only flagging drift against a fixed median. The
  design turns on one insight from a real field morning: a "Replan from
  now" run (0.12.0's compressPlan) squeezes the remaining steps down to
  whatever time is left before the door — a step compressed from 15 minutes
  to 6 and checked off in roughly 6 minutes did NOT become a 6-minute step,
  it got squeezed once, under pressure, because the appointment demanded
  it. Folding that into the same pool as every normal run would teach the
  learner a false "normal" pace. So there are now two distributions, never
  mixed: **natural** actuals (uncompressed, genuinely lived runs) feed
  estimates; **rushed** actuals (compressed runs only) feed compression
  floors. A new `Departure.wasReplanned` flag, stamped only by "Replan from
  now"'s Apply (never by re-anchor, which moves the appointment target but
  never touches step time), is what keeps the two apart.
  - New `src/lib/learning.ts`: `naturalActualsByStepName`/
    `rushedActualsByStepName` build the two pools (excluding batched
    check-off runs — 3+ steps ticked within the same minute is someone
    catching the app up after the fact, not a timed measurement — and
    capped to the most recent 14 occurrences per step, since habits drift).
    `learnedEstimate` plans at the 75th percentile, not the median — the
    median is, by construction, late half the time; P75 covers three of
    every four real runs. `learnedRushedFloor` (P25 of the rushed pool,
    minimum 1) is what a step has proven it can actually be squeezed to.
    `learnedBufferSuggestion` surfaces a persistent out-the-door slip
    (median over the last 10 left/done runs, ≥5 required, only above a
    2-minute threshold).
  - **Auto-learn** (opt-in, per template — TemplateEdit's "Learn step times
    automatically" toggle): after a departure of an autoLearn template
    reaches left/done, `src/lib/autoLearn.ts`'s `applyAutoLearn` rewrites
    any step whose learned estimate has drifted ≥2 min from what's saved,
    then runs the same replace-untouched-future-rows + re-materialize chain
    a manual template edit does, so the planned week follows. The one place
    in the app a learned value writes itself without a tap — sanctioned
    because it's chosen (the toggle), visible, and labeled: a step whose
    minutes equal its learned value shows a faint "learned · N runs" line.
  - **Personalized compression floors**: `compressPlan` (replan.ts) now
    accepts an optional `floorsByStepName` map: instead of every step
    flooring at a generic 1 minute when squeezed hard, a step with rushed
    history floors at what it's actually proven to compress to. Runway's
    replan panel computes this lazily, only while open, from the
    departure's own template history — no copy change, the numbers
    offered just get smarter.
  - **Home's suggestion cards** now read from `learnedEstimate` (P75)
    instead of the raw median, and only from the natural pool — a
    compressed run can no longer contaminate a suggested step time. A new
    buffer-suggestion card variant ("You typically leave N min after your
    planned time. Add N min to the buffer?") is always suggest-only,
    independent of a template's autoLearn flag.
  - **Task-memory autocomplete**: typing 2+ characters into a step-name
    field (TemplateEdit, DepartureSetup) shows up to 4 matches from every
    step name ever used, with learned minutes attached where available —
    selecting one fills the name and (when learned) the minutes. A small
    custom dropdown (`src/ui/StepNameAutocomplete.tsx`), not a native
    `<datalist>`, because a `<datalist>` option can't carry the minutes
    value along with the label.
  - All of this stays on-device — the two distributions, every learned
    estimate, and the autocomplete library are all computed from Dexie data
    already local to this phone; nothing new is sent anywhere.
  - `Departure.wasReplanned` and `Template.autoLearn` are both new,
    non-indexed fields (undefined reads as `false` everywhere, same
    treatment as every other late-added field in this schema) — no Dexie
    version bump needed.
  - versionCode 26.

## 0.19.0
- Quick capture (ecosystem increment E2): a dictation-first way to start a
  departure. Home gains a single-line input — "Dictate a departure — name,
  day, time, place." — shown only once a Gemini API key is set in Settings
  → Quick capture. One dictated sentence ("Zahnarzt Donnerstag 14:30 in
  Ludwigsburg") is sent to the Gemini API (`gemini-2.0-flash`,
  `src/lib/geminiApi.ts`), which reads across mixed German/English/other
  languages and returns a structured draft (name, destination, date, time)
  via a JSON response schema — never a saved departure. The draft always
  lands in DepartureSetup, prefilled, for explicit confirmation
  (`prefillName`/`prefillDestination`/`prefillAppointmentIso`, reusing E1's
  prefill mechanism) — nothing is written to Dexie until Save is tapped
  there. If no time was heard, the sentence is never invented a time: only
  the date prefills (new `prefillDate`/`prefillTimeMissing`) and
  DepartureSetup shows "No time was heard — check it." with Time left
  blank. A parse failure (bad key, network error, unexpected response
  shape) shows inline — "Could not parse that — try again or enter it
  manually." plus the specific reason — and the sentence stays in the box
  to retry or edit. New `src/lib/captureSettings.ts` (the key's
  read-through config, same shape as `liveTravelSettings.ts`/
  `reportSettings.ts`) and `src/lib/geminiApi.ts` (request building,
  defensive response parsing, and the network call — CapacitorHttp on
  native / fetch on web, 20 s timeout, never throws, mirroring
  `routesApi.ts`'s `fetchDriveMinutes`).
  - versionCode 25.

## 0.18.0
- Step focus: tapping a step's name on the live Runway screen opens a
  full-screen, true-black (#000, OLED pixels off) countdown for exactly
  that step — its genuine remaining time from the same timestamps
  calibration uses, never a fresh timer. Digits shift white → amber
  (last quarter) → red (final tenth); past zero they count up "+m:ss"
  and a dark-red field rises from the bottom proportional to the overrun
  — distance-and-steam legibility, the one sanctioned use of a moving
  surface. Tap anywhere: step done, next step's countdown appears — the
  whole prep chain becomes one distraction-free screen. Back chevron
  exits without checking; a non-current step shows its planned time
  static ("Starts when the steps before it are done.") because a
  countdown for an unstarted step would be fiction. Leave-by stays
  visible at the bottom throughout.

## 0.17.0
- Calendar and sharing (ecosystem increment E1) — two independent entry
  points that both land in the same place, DepartureSetup prefilled:
  - **Calendar read**: Home gains a "From your calendar" section (native
    only) showing the next 48 h of timed device-calendar appointments
    (all-day events skipped — no time to plan a departure against), capped
    at 3, each with a "Plan departure" action that opens DepartureSetup
    prefilled with the appointment's name and time. Off by default; a quiet
    one-tap enable ("Show calendar appointments here.") requests
    READ_CALENDAR lazily, on that tap only — never at app open. A denial
    means the section renders nothing further for the rest of that session,
    re-enablable from a new Settings → "Show calendar appointments on Home"
    toggle. Read-only: Runway never writes to the calendar. New
    `CalendarBridgePlugin.java` (queries `CalendarContract.Instances`, the
    expanded-occurrence view, so recurring appointments show their actual
    next occurrence rather than the series' original creation time),
    `src/native/calendar.ts`, and `src/lib/calendarEvents.ts`'s
    `eventsWithoutDepartures` — an event already planned for (any departure
    status, appointment time within ±5 min) never resurfaces, so this
    section can't turn into a repeat-nag for the same appointment.
  - **Share target**: Runway now registers as an Android share target for
    plain text. Sharing a place from Google Maps ("Share" → Runway) opens
    DepartureSetup prefilled with the place name, stripped of the maps.app
    link Maps includes alongside it (`src/lib/shareTarget.ts`'s
    `parseSharedDestination`). Implemented as a same-file intent rewrite in
    `MainActivity.java` (`rewriteShareTargetIntent`, in both `onCreate` and
    `onNewIntent`) that turns the incoming `ACTION_SEND` into a
    `runway://share-target?text=...` deep link — the existing widget-era
    deep-link machinery then delivers it with zero new native bridge code.
  - versionCode 23.

## 0.16.0
- UI-polish increment: a visual-layer-only pass across every screen — no
  logic, data, or copy changed (a handful of class-level copy exceptions are
  flagged in the PR description, not silently made). New fixed design
  tokens: `surface`/`raised` card and input background colours
  (`tailwind.config.ts`), a 150ms screen-mount fade (`App.tsx`, keyed by
  screen name), and a small motion vocabulary — colour-state crossfades on
  Runway's/ExamOverview's centerpiece text, borders, and slack/margin lines,
  a strikethrough-and-dim fade on checked Runway steps, and a fade-in on
  every inline confirmation panel (replan, re-anchor, "repeat" toggle). All
  of it lives behind Tailwind's `motion-safe:` variant, so
  `prefers-reduced-motion: reduce` gets every end state instantly, with no
  animation/transition property applied at all.
  - New `src/ui/TextAction.tsx`: the shared component for every quiet
    text-only action (Home's footer nav, Runway's Replan/Abandon,
    ExamOverview's Add milestone/Edit exam/Edit topics, MilestoneEdit's
    Edit/Delete, ReportProblem's Retry, and more) — one shade of slate
    (`text-slate-400` → `hover:text-slate-100`) everywhere, replacing a mix
    of ad-hoc greys and, in several places, a sky-400 accent that the new
    design system reserves for primary buttons and the two genuinely
    external actions that keep it (DepartureSetup's "Check route in Maps"
    and "Fetch live travel time"). Trade-off worth naming: Abandon/Remove/
    Delete previously turned red on hover as a destructive-action cue;
    `TextAction`'s fixed styling removes that (the confirm dialogs these
    actions already require are still the actual safety net).
  - `src/ui/Button.tsx` reworked to the fixed primary/secondary/danger
    variants (inverted-text primary, outlined secondary, dark-red danger),
    `min-h-12` (up from 44px), and a visible focus ring throughout.
  - Checkboxes across every screen now use Tailwind's `accent-sky-500`
    utility — the previous `text-sky-500` class was a no-op on a native
    checkbox (no `accent-color` source), so this is a real, not merely
    cosmetic, fix: checkboxes previously rendered in the OS/browser's
    default tint rather than app-accent sky.
  - New emerald-300 "Moments" acknowledgment tone, applied to exactly four
    existing lines, wording unchanged: Runway's "out the door early/on
    time" summary (late stays red), PostSprintView's "N min on topic" line,
    ExamOverview's all-topics-at-estimate margin line, and History's
    early/on-time result column (late stays red there too).
  - Section headers normalized to 11px/`tracking-[0.15em]`/faint (slate-500)
    everywhere; card shape normalized to `rounded-xl` + 60%-opacity border +
    `p-4`; input shape normalized to `rounded-lg` + `min-h-12` +
    `bg-raised`/`border-slate-700`.

## 0.15.1
- Fix (field report #9): a recurring template's auto-materialized
  occurrences (up to `HORIZON_DAYS` = 7 of them, see `src/lib/recurrence.ts`)
  no longer render as that many near-identical cards in Home's Upcoming
  list. Only the soonest occurrence of each template renders — as a card
  otherwise unchanged, plus one added quiet line, "Repeats Mon–Fri · 08:00",
  built from the template's own schedule (new `formatScheduleDays` in
  `src/lib/format.ts`). The rest of that week's occurrences are untouched
  under the hood: still real `Departure` rows, alarms still armed, still
  individually reachable from History — this is a Home-screen rendering
  change only. A manually created departure (no `scheduledForDate`) is
  never collapsed, since it has no siblings to collapse with. The existing
  "+N more planned" cap-overflow count now counts only cards genuinely
  hidden by `MAX_VISIBLE_UPCOMING`, not the folded-away siblings of a
  collapsed template — counting those would have reintroduced the same
  noise this fix removes, just as a number instead of as cards.

## 0.15.0
- Field reports: a quiet "Report a problem" link on Home and on Settings
  opens a small form — description (required, multiline, dictation-
  friendly: no character limit) plus an optional screenshot
  (`<input type="file" accept="image/*">`, read to base64 client-side, 4 MB
  cap with an exact rejection message, thumbnail preview + remove). Saving
  writes a `FieldReport` row to a new Dexie table (`fieldReports`, v4 —
  see db/db.ts's version() comments for why this is a genuine schema bump,
  unlike the last several increments' non-indexed field additions)
  **unconditionally** — the local save always succeeds, regardless of
  connectivity or whether a sync token is configured. That local write IS
  the feature; everything past it is a best-effort enhancement.
  - `src/lib/reportSync.ts`'s `syncPendingReports()` walks the pending
    queue (oldest first, sequential — reports are rare, no parallelism
    earns its complexity here) on every app open (`main.tsx`) and files
    each as a GitHub Issue via the REST API (screenshot uploaded first, to
    `field-reports/` in the target repo, then linked into the issue body).
    No token configured means every report just stays `'pending'` forever
    — silently, correctly, not an error state.
  - **401/403/404/422 (bad token, bad repo, validation error) mark a
    report `'failed'` permanently** — the exact GitHub status + message is
    stored and shown verbatim, because retrying identical bad input would
    only fail identically. Network errors, timeouts, and 5xx leave the
    report `'pending'` for the next automatic retry. A manual "Retry" on
    any failed/pending row in the report list re-attempts immediately
    rather than waiting for the next app open.
  - New Settings section ("Feedback"): a fine-grained GitHub token
    (password field, stored only on this device, same save/clear pattern
    as the Routes API key) and a target repo (defaults to `Bosonian/Play`
    when left blank — see this file's README section for the
    fine-grained-PAT setup steps and the public-repo privacy tradeoff).
  - `APP_VERSION` (`src/lib/appVersion.ts`, new) is now the one hardcoded
    version string every field report stamps itself with — **must be
    bumped alongside `versionName` in `android/app/build.gradle` by hand**;
    nothing enforces the two staying in sync yet (v1.5 candidate: build-time
    injection).
  - `buildIssuePayload()` and `classifySyncError()` are pure and
    independently tested (`reportSync.test.ts`, 18 new cases) — title
    truncation at the 60-character boundary, the context block's exact
    content, screenshot-markdown presence/absence, and the full
    401/403/404/422-vs-everything-else classification table.

## 0.14.0
- Recurring departures: a Template can now carry a repeating schedule —
  "reach work at 08:00 Mon-Fri" — via a new "Repeat" section on
  TemplateEdit (a toggle, a 24h time field, and Monday-first M T W T F S S
  day chips). `src/lib/materialize.ts`'s `materializeScheduledDepartures()`
  reads every scheduled template and auto-plans real departures up to 7
  days ahead (`src/lib/recurrence.ts`'s `occurrenceDates`, pure and
  unit-tested, 8 new cases including a DST-week sanity check), creating
  them exactly the way DepartureSetup's own create path does — fresh step
  ids, `status: 'planned'`, alarms scheduled the same way. Runs on every app
  open (`main.tsx`) and again right after a template save
  (`TemplateEdit.tsx`), so a schedule/step/travel edit propagates into the
  week that's already planned — but only for FUTURE, UNTOUCHED rows (never
  re-materialize over a departure Deepak has already started).
  - **Never re-creates an abandoned occurrence.** The materializer's dedup
    key is `(templateId, scheduledForDate)` alone, independent of that
    date's departure's current status — if a materialized morning is
    removed, it stays gone; silently bringing it back would be nagging, not
    help.
  - **Stale auto-rows are hard-deleted, not demoted to History.** A
    machine-created departure nobody ever started (`startedAt` still null)
    more than 12h past its appointment is deleted outright, alarms
    cancelled — it was never a real commitment Deepak engaged with, so
    letting it pile up in Home's "Past departure time" section would slowly
    build a guilt list of mornings that were never real to begin with. A
    departure he DID start keeps the ordinary lifecycle untouched.
  - Home's Upcoming list is now capped at the nearest 5 departures, with a
    quiet "+N more planned" line beyond that — a fully-scheduled week would
    otherwise dump up to 7 near-identical cards on the one screen this app
    is supposed to keep calm.
  - **Stated plainly, not hidden:** the 7-day horizon means alarms only
    stay armed if Runway is opened at least once a week — there is no
    background materializer in this increment. A WorkManager-based native
    materializer that doesn't depend on the app being opened is the v1.5
    upgrade (see this README's own v1.5 list).
  - New fields, both non-indexed (no Dexie version bump, same treatment as
    `originalAppointmentAt`): `Template.schedule` (`{ time, days } | null`)
    and `Departure.scheduledForDate` (`string | null`, the materializer's
    join key). Every read treats a legacy row's missing property the same
    as an explicit `null` — the exact bug class the 0.13.0 review caught
    for `originalAppointmentAt`.

## 0.13.0
- Fix from a real-device field report: appointment 17:00, opened Runway at
  18:14 (75 min past). "Replan from now" correctly showed the refusal ("No
  plan reaches 17:00 on time…"), but two things were broken on top of that:
  - The quiet "Replan from now." action at the bottom of the screen was
    inert once the panel was already open — it set `replanOpen` to a
    hardcoded `true`, so tapping it again while open did nothing, and there
    was no way to close the panel from that button. Now toggles.
  - Once `leaveBy` (appointment minus travel) has actually passed, there is
    no time left to travel at all — compression has nothing honest left to
    offer, and the refusal it showed instead was a dead end: no button on
    that panel could get you unstuck. A new **re-anchor** panel now
    supersedes the refusal in exactly that case: "{appointment} has passed.
    Set a new target to replan against," a time input prefilled with a
    live-updating suggested target (now + remaining plan + travel, rounded
    up to the next 5 minutes — see `suggestNewTarget` in `src/lib/
    replan.ts`), and "Re-anchor to {time}" writes a fresh `appointmentAt`
    and reschedules alarms against it.
  - **`originalAppointmentAt`** (new field, `src/db/types.ts`): the slip/
    lateness record (History, and Runway's own "Out the door N min late"
    summary) now always measures against the ORIGINAL commitment, not
    whatever `appointmentAt` happens to be right now. A deliberate Edit
    (DepartureSetup, on a 'planned' or 'running' departure) updates both
    fields together — an edit means reality moved, so the "original"
    commitment moves with it. The re-anchor action above deliberately does
    NOT touch this field — re-anchoring rescues a departure without
    rewriting how late it actually ran, so a re-anchored departure that
    arrives against its new target still shows up in History measured
    against the one it actually missed. `null` on pre-existing rows;
    Dexie needs no schema-version bump for a non-indexed field, and the
    first re-anchor of such a row backfills it from that row's current
    `appointmentAt` at that moment (see the field's own doc comment for
    why that one-time backfill is correct).
  - Known imprecision, stated plainly rather than hidden: the re-anchor
    copy always reads "{appointment} has passed", but the panel's trigger
    condition is `leaveBy <= now`, not `appointmentAt <= now` — with a
    long travel time, it's possible for `leaveBy` to have passed while the
    appointment itself is still technically ahead. The copy would be
    inaccurate in that narrow case. Not fixed here because the panel's
    entire point in that moment is the same either way (no plan reaches the
    appointment on time; a new target is needed), but worth a second pass
    if it turns out to matter in practice.

## 0.12.1
- Fix from first real use: "Replan from now" on a plan that already fits
  said nothing and offered a no-op Apply. It now states the true thing:
  "The plan already fits — N min to spare. Nothing to compress." Replan
  only ever compresses; it never expands a plan.
- Hardened Apply against the check-a-step-while-applying race (per-id
  merge instead of whole-array write).

## 0.12.0
- Recover instead of forfeit — three ways back in when a departure plan has
  already slipped, instead of the only options being "push through" or
  abandon:
  - **Replan from now** (`src/lib/replan.ts`'s `compressPlan`, pure and
    unit-tested independent of the UI). A quiet "Replan from now." text
    action on the live Runway screen, always available while a departure is
    under way — not gated to the late state, since slack can be quietly
    tightened before it's actually gone. Once projection reaches the 'late'
    state, an inline hint ("The plan no longer fits. Replan from now?")
    appears above the step list too. Tapping either opens an inline
    confirmation — never a modal, never applied automatically — showing
    exactly what would change: old → new minutes per unchecked step and for
    the buffer, computed by scaling the remaining plan down to fit whatever
    time is actually left before leaveBy, floored to a 1-minute-per-step /
    2-minute-buffer minimum (a zero buffer stays zero). If even those floors
    don't fit the time remaining, the app says so plainly instead of
    offering a plan that's technically "compressed" but not actually
    workable. Checked steps are never touched — they're history.
  - **Snooze on "Start getting ready."** — that alarm only (not "Wrap up",
    "Leave in 5", or "Leave now": snoozing any of the later three would be
    self-deception with a UI, since the appointment doesn't move just
    because the alarm did). One tap, `+10` minutes, reschedules the same
    alarm in place — tapping the notification body still opens the
    departure exactly as before.
  - **Edit a running departure.** Home's "Edit" action is no longer
    'planned'-only. Editing a departure already under way locks
    already-checked steps (dimmed, "done", no inputs) — their `checkedAt`
    history survives the edit untouched — while everything else (step
    names/minutes, adding/removing unchecked steps, the appointment time,
    travel, buffer) stays editable. Saving reschedules alarms the same way
    saving a 'planned' departure always has. This is for when reality
    moved — the Termin got pushed back, a step is taking longer than
    planned — not a soft-delete; Abandon (on the Runway screen) stays the
    only real exit from a run being given up on.
  - Device-only-verifiable: snoozing with the app fully closed depends on
    the same "Capacitor's bridge buffers an action-performed event until a
    JS listener attaches" behaviour the existing cold-start notification-tap
    case already relies on and already flags as unverified — noted again
    here rather than assumed fixed.

## 0.11.1
- Widget review round (adversarial pass on 0.11.0's W1+W2 work), seven
  findings fixed:
  - The widget picker showed two blank tiles both named "Runway" with no
    way to tell them apart before placing one. Each `<receiver>` now has
    its own `android:label` ("Prüfung" / "Next departure") and, on API 31+,
    its own `android:description`; both layouts' TextViews now carry
    static placeholder text (the picker's own preview, when no
    `previewImage` is set) instead of rendering blank.
  - The Prüfung widget said "Open Runway once to fill this widget." even
    when the app HAD already run and simply had no exam set up yet —
    unactionable and false. That case now reads "No exam set up." instead,
    with the same tap target (`runway://exam`, which already routes to
    exam setup when none exists); the old fallback copy is reserved
    exclusively for "no snapshot has ever been written."
  - The widget's "Ready by" date and the app's own ExamOverview screen
    could disagree by a day. Replaced the offsetDays/`Math.ceil` scheme
    with midnight-anchored calendar sliding (`readyDayEpochMs` +
    `generatedDayEpochMs` in `widgetSnapshot.ts`, floored the same way on
    both the native and TS sides) so the two agree by construction.
  - Checking the last prep step on the live Runway screen didn't refresh
    the departure widget, leaving a stale "start by ..." on the home
    screen after every step was actually done.
  - Reopening Runway from Android's Recents list after the process had
    died re-fired the app's original launch intent, including any stale
    `runway://` deep link it carried — `MainActivity` now strips it before
    `super.onCreate()` when `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` is set.
  - A cold start via a widget/shortcut tap could deliver the same deep
    link twice (once via the synthesized `appUrlOpen` retained event,
    once via `getLaunchUrl()`) — `deepLinks.ts` now dedupes by URL.
  - Documented, rather than engineered around: widget expiry (the
    departure widget's stale-appointment fallback) is only evaluated at
    redraw — up to ~6h stale if the app stays closed. Info-xml comment and
    README corrected to say so plainly instead of implying a live check.

## 0.11.0
- Second home-screen widget: the next departure. Three lines — name,
  appointment time, and a "Leave by 14:10 · start by 13:35" plan line that
  drops the "start by" half once every prep step is checked. Shows the
  soonest 'planned'/'running' departure whose appointment hasn't slipped
  more than an hour into the past (the same cutoff Home's own
  Upcoming/Past split uses — pulled into a shared lib constant,
  `src/lib/departureThreshold.ts`, so the two can't drift apart); falls back
  to "No departure planned." — tapping that fallback opens Home — when
  nothing qualifies. **Expiry rule:** unlike the Prüfung widget's "Ready by"
  date, which stays correct on its own by sliding forward with the real
  calendar, a departure fact goes stale outright — the native widget
  re-checks `now` against the snapshot's `appointmentEpochMs` on every
  redraw and falls back rather than keep showing a stale "Klinik 14:30"
  from a departure that's since been left, missed, or removed while the
  app was closed.
- Two more deep links, `runway://departure/{id}` and `runway://home`,
  reached from the new widget's tap targets. `WidgetBridgePlugin` now pokes
  both widget providers on every snapshot write, not just the Prüfung one.
- `refreshWidgets()` gained five more call sites: DepartureSetup's save,
  Runway's handleLeave and handleAbandon, Home's removeDeparture and its
  three arrival-capture writes, and useLiveTravel's ≥3-min drift write
  (leaveBy moves when travelMinutes does, and the widget's plan line shows
  leaveBy) — see that function's own doc comment in src/native/widgets.ts
  for the full, current call-site list.

## 0.10.0
- Home-screen widget for Prüfung mode: ready-by date, exam anchor, and
  this-week's hours, refreshed explicitly after every sprint/exam/topic/
  milestone save (never on a generic Dexie hook). The app's first native
  Kotlin/Java: a local `WidgetBridge` Capacitor plugin (JS → SharedPreferences
  → widget redraw) and the `PruefungWidgetProvider` widget itself, both
  written in Java (this project has no Kotlin toolchain configured yet — see
  the increment's own notes on why Java was the safer first-try-compile
  choice). All pace/remaining-hours/projection math stays in TypeScript; the
  native side only slides a date forward by a day-count and diffs two dates,
  never re-derives the equation.
- Deep links (`runway://exam`, `runway://new-departure`) via `@capacitor/app`,
  and two static home-screen shortcuts ("New departure", "Prüfung") reachable
  by long-pressing the app icon. Both the widget's tap target and the
  shortcuts route through the same deep-link handling.

## 0.9.0
- Live travel times for departure mode: an optional Google Routes API
  integration, off by default. New Settings screen (Routes API key +
  "use live travel times" toggle). DepartureSetup gets an explicit
  "Fetch live travel time" button. The Runway screen refreshes travel
  time live every 3 min while a departure is running, writing back to
  `travelMinutes` (and rescheduling alarms) only when the live figure
  drifts 3+ min from the plan — smaller drift is shown but not written,
  to avoid alarm churn over noise. Everything still works without a key:
  travel minutes fall back to the manual estimate.

## 0.8.0
- Prüfung guided layer: next-move card (one suggested sprint with its
  reasoning shown, one tap to start, ritual preserved), first-open
  walkthrough, optional Facharzt Neurologie topic template (draft numbers,
  to be corrected against the real exam contents).
- Fix: the departure-mode first-run setup card never showed on a fresh
  install (loading and never-dismissed states were indistinguishable).

## 0.7.0
- Prüfung mode review round: 13 findings fixed, including the week-one/
  week-two "Never" projections, silent wall-clock logging of forgotten
  sprints, zombie-sprint recovery, and missing years on far ready-dates.

## 0.6.0
- Prüfung mode: exam + topics, measured-pace ready-date projection,
  25/50/90-minute sprints with start ritual, milestones with morning-of
  alarms and per-milestone projections.

## 0.5.0
- Departure-mode review round: save resilience under denied notification
  permission, edit/remove/abandon paths, explicit run start, past-due
  section, transactional step toggles.

## 0.4.0
- Icon and splash, first-run setup card, copy audit.

## 0.3.0
- Calibration: per-step actuals, estimate suggestions, arrival capture,
  history with median slip.

## 0.2.0
- Native staged alarms (exact, Doze-proof), Maps handoff, keep-awake,
  haptics.

## 0.1.0
- Departures: backwards-planned prep, live slipping arrival projection,
  leave-now flow. First APK pipeline.
