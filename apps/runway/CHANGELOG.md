# Runway changelog

Versions map to `versionName` in `android/app/build.gradle`. Install always
via the `runway-latest.apk` asset at
https://github.com/Bosonian/Play/releases/tag/runway-latest — it carries
whichever version built last.

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
