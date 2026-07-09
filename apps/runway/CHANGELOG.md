# Runway changelog

Versions map to `versionName` in `android/app/build.gradle`. Install always
via the `runway-latest.apk` asset at
https://github.com/Bosonian/Play/releases/tag/runway-latest — it carries
whichever version built last.

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
