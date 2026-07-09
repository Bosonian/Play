# Runway changelog

Versions map to `versionName` in `android/app/build.gradle`. Install always
via the `runway-latest.apk` asset at
https://github.com/Bosonian/Play/releases/tag/runway-latest — it carries
whichever version built last.

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
