# Runway

Runway is the departure-timing app described in [`../../docs/RUNWAY_PLAN.md`](../../docs/RUNWAY_PLAN.md): it projects an arrival time from a live prep-and-travel countdown — the same "watching the number slip" effect Google Maps produces on a walk to the car, applied to getting out the door on time. It is a personal tool for one user, not a published app.

## Develop

The app is ordinary React + TypeScript + Vite + Dexie, runnable in any browser:

```sh
npm install
npm run dev
```

`npm run build` produces the static `dist/` bundle. `npm run typecheck` and `npm run test` run TypeScript's checker and the Vitest suite.

## Get the APK

Every push touching `apps/runway/**` rebuilds the Android APK via GitHub Actions and refreshes a standing prerelease at:

**https://github.com/Bosonian/Play/releases/tag/runway-latest**

To install on the S25 Ultra:

1. Open that release page in Chrome on the phone.
2. Download the `runway-latest.apk` asset — the filename stays constant across builds, so each release replaces it rather than piling up sha-named files; the release body names the exact version and commit it was built from.
3. Open the downloaded file. The first time, Chrome will ask permission to install unknown apps — allow it for Chrome (Settings → Apps → Special access → Install unknown apps).
4. Install. Updates install over the existing app and Dexie data survives; it does **not** survive an uninstall.

## Battery optimization

Runway's staged alerts are scheduled as exact, Doze-proof Android alarms (RUNWAY_PLAN.md §5.5), but two Android settings still decide whether they actually arrive on time. The app surfaces the first as a one-time card on Home the first time you open it, and the second isn't something the app can prompt for without an extra plugin (see "v1.5 candidates" below) — so it's worth doing once, by hand, before relying on Runway for a real appointment:

1. **Allow notifications when Runway asks** — this happens automatically when you save your first departure.
2. **Settings → Apps → Runway → Battery → choose Unrestricted.** Samsung's battery optimizer defers alarms for apps left on the default setting, exact-alarm permission or not.

## When the plan slips

A plan that's already fallen behind used to leave two options: push through a schedule that no longer fits, or abandon the departure outright. As of 0.12.0 there's a third: recovery is one tap, forfeit is never required.

- **Replan from now**, on the live Runway screen — squeezes the remaining unchecked steps and the buffer down to whatever time is actually left before you need to be out the door, and shows you exactly what changes (old → new minutes, per step) before anything is applied. Available any time a departure is under way, not just once it's gone late. If the remaining time genuinely can't fit even a minimal version of the plan, it says so plainly instead of pretending a workable plan exists.
- **Re-anchor**, once the door itself has already passed and there's no time left to compress anything — the same panel offers a fresh target instead of a dead-end refusal, prefilled with an honest suggestion (now, plus what's actually left, rounded up to the next 5 minutes). Choosing to re-anchor keeps the record true: the original appointment stays what History and the "out the door" summary measure lateness against, so a rescued departure never quietly reads as having been on time.
- **Snooze**, on the "Start getting ready." alarm only — ten more minutes, one tap, no need to open the app. The later alarms ("Wrap up", "Leave in 5", "Leave now") don't offer this: the appointment doesn't move because the alarm did, so snoozing those would just be a later, equally real lateness.
- **Edit a running departure**, from Home — for when reality moved (the appointment got pushed back, a step is taking longer than planned), not for erasing a run that's going badly. Steps already checked off stay locked; everything else can still change, and alarms reschedule to match.

## Arrival steps

"On time" was never really the hospital door — it's the ward station, after changing into scrubs and taking the lift. `appointmentAt` has always been the true target Runway's whole equation is built around; arrival steps (0.21.0) are for the appointments where travel genuinely doesn't end at the building, and there's a real, worth-tracking gap between arriving and the appointment itself.

A Template (or a from-scratch Departure) can carry a second, optional list of steps below the usual prep steps — "Change into scrubs," "Take the lift," "Walk to the ward" — that live after travel and before the true target. Empty by default; most departures never touch this section, and nothing about them changes.

**The math gains a term, nothing else changes shape.** Projected arrival now adds remaining (unchecked) arrival-step minutes on top of remaining prep, buffer, and travel; leaveBy, the four staged alarms, and the "start getting ready by" preview all shift earlier by the same amount — every one of them, automatically, the moment a departure has any arrival steps at all.

**The Runway screen gets a live arrival phase.** Once a departure with arrival steps reaches "left" status, it no longer shows the old plain "Logged ... Safe travels." note — instead, the same live centerpiece continues (projection vs. the true appointment), gated behind an explicit "I'm at the building" tap. That tap is deliberate, not inferred: there's no honest signal in this app to guess "arrived" from, and guessing (say, leftAt plus travel time) would silently misattribute however long the actual journey took — traffic, parking, walking from the car — onto the first arrival step's timer. Once tapped, the arrival-steps checklist activates with the same check-off mechanics as prep, including step-focus tap-through. Checking the LAST arrival step resolves the whole departure automatically: status "done," `arrivalResult` derived from the exact checked-off timestamp against the appointment — the most precise arrival capture this app has ever produced, no after-the-fact guess required. A departure without arrival steps behaves exactly as it always has.

**Calibration keeps the journey out of the arrival steps' actuals.** `deriveStepActuals` reconstructs two independent chains now: prep, anchored at `startedAt` (unchanged), and arrival, anchored at `arrivedAt`, never chained onto the prep steps. The gap between "last prep step checked" and "arrived at the building" is the journey itself — folding it into the first arrival step's measured time would teach the learner that changing into scrubs takes forty minutes when thirty-eight of those were spent driving. A departure whose arrival phase never began contributes no arrival actuals at all. Auto-learn and the task-memory autocomplete both treat arrival steps as steps; Home's suggest-and-confirm cards stay prep-only for now — a deliberately narrower scope, worth reconsidering once there's real arrival-step history to look at.

**Home's "Waiting on arrival" skips departures with arrival steps** while they're still under way — that departure resolves itself, more precisely, from the Runway screen's own arrival phase, and offering it there too would let a stray Early/On time/Late tap short-circuit the more honest capture.

## Learning

Runway learns realistic per-step and buffer times from lived data, rather than relying only on whatever was typed in at setup or a fixed median that's late half the time by construction.

**The rule that matters most: a compressed run never teaches a natural time.** A "Replan from now" run (see "When the plan slips" above) squeezes the remaining unchecked steps down to whatever time is actually left before the door. A step compressed from 15 minutes to 6 and checked off in roughly 6 minutes did NOT become a 6-minute step that morning — it got squeezed once, under pressure, because the appointment demanded it. Folding that measurement into the same pool as every normal, uncompressed run would teach the learner a false "normal" pace: the average of one real morning and one compressed one, describing neither. So there are two distributions, kept apart everywhere in `src/lib/learning.ts`: **natural** actuals (uncompressed, genuinely lived runs) feed estimates and suggestions; **rushed** actuals (compressed runs only) feed compression floors — never estimates. `Departure.wasReplanned`, stamped only when "Replan from now"'s Apply is tapped (never by re-anchor, which moves the appointment target but never touches a step's planned time), is the flag that keeps the two pools separate.

**The P75 rule.** A learned estimate plans at the 75th percentile of a step's natural actuals, not the median. The median is late half the time by construction — half of any set of real runs take longer than their own median. Planning at P75 means the estimate covers three out of every four real runs instead of one out of two, which is what actually reduces the "the plan said 15 and it's already been 18" mornings. A learned estimate needs at least 3 natural samples to exist at all, and each step's history is capped to its most recent 14 occurrences — habits drift, and an uncapped history would let behaviour from months ago permanently drag a learned value away from how the step goes today.

**Batched check-offs teach nothing.** A run where 3 or more steps were checked off within the same one-minute span is someone catching the app up after the fact — ticking boxes for steps that already happened, not timing them live. That run is excluded from both the natural and rushed pools entirely (`isBatchedRun`), rather than contributing a set of gap measurements that would just be noise.

**Auto-learn, opt-in per template.** TemplateEdit's "Learn step times automatically" toggle turns on `src/lib/autoLearn.ts`'s `applyAutoLearn`, fired after a departure of that template reaches left/done: it recomputes each step's learned estimate from that template's own natural history and writes any step whose estimate has drifted 2 minutes or more from what's currently saved, then runs the same replace-untouched-future-rows-and-re-materialize chain a manual template edit does, so the already-planned week follows. This is the one place in the app where a learned value writes itself without a tap — sanctioned automation, not a silent background rewrite, because it's chosen (the toggle has to be turned on), visible (a step whose minutes equal its learned value shows a faint "learned · N runs" label in TemplateEdit), and a manual edit to that step always wins and becomes the new baseline going forward. Non-autoLearn templates keep the existing suggest-and-confirm pattern: Home's suggestion cards now read the same P75 estimator, but never write anything without an explicit "Update to N min" tap.

**Personalized compression floors.** A step's history of compressed runs (the rushed pool above) proves what it can actually be squeezed to under pressure — `learnedRushedFloor` (the 25th percentile of that history, minimum 1 minute) replaces the generic 1-minute floor `compressPlan` used to apply to every step uniformly. The Runway screen's replan panel computes this lazily, only while the panel is open, from the departure's own template history. No copy changed for this — the numbers offered during a real replan just get smarter as more compressed runs accumulate.

**Task-memory autocomplete.** Typing 2 or more characters into a step-name field (TemplateEdit or DepartureSetup) shows up to 4 matching step names ever used anywhere in the app, most-used first, with learned minutes attached where at least 3 natural samples exist. Selecting one fills the name (and, when a learned value exists, the minutes) in one tap — a small custom dropdown (`src/ui/StepNameAutocomplete.tsx`), because a native `<datalist>` option can only carry a text label, not the minutes value selecting it should also fill in.

**Everything here stays on this device.** The natural/rushed pools, every learned estimate, and the autocomplete library are all computed from Dexie data already local to the phone — nothing new is sent anywhere for this feature, unlike the optional live-travel and quick-capture features above which do call external APIs.

## Recurring departures

A Template can carry a repeating schedule instead of only being a one-tap starting point for a single departure. On TemplateEdit, turn on "Repeat this departure," set a 24-hour time, and pick the days (Monday-first chips, matching this app's week-starts-Monday convention everywhere else) it repeats on — "reach work at 08:00 Mon–Fri," for instance.

**How it works:** every time Runway opens, and again right after a scheduled template is saved, `materializeScheduledDepartures()` (`src/lib/materialize.ts`) looks up to 7 days ahead and creates whichever of those days' departures don't already exist — same fields, same step copying, same alarm scheduling as adding a departure from a template by hand. A day that's already been materialized once is never re-created, even if you remove that departure afterwards: bringing back a morning you deliberately cleared would be nagging, not help. Editing a scheduled template's steps, time, days, travel, or buffer replaces only the FUTURE departures you haven't touched yet (haven't started, appointment still ahead) with fresh ones reflecting the edit — anything already started stays exactly as it is, because that run is yours now, not the template's to rewrite.

**Open Runway at least once a week to keep alarms armed.** The materializer only plans 7 days out and only runs while the app is open — there is no background scheduler in this version. If Runway goes unopened for more than a week, the days beyond the last materialization simply never get created (and never alert), until the next time you open it.

A machine-created departure you never engage with (never started) gets quietly deleted, alarms cancelled, once it's more than 12 hours past its appointment — it was never a real commitment, so it doesn't linger in the Past section as one. A departure you did start keeps the normal history/calibration lifecycle like any other.

Home's Upcoming list caps at the nearest 5 departures regardless of how many are planned, with a quiet "+N more planned" line for the rest — a fully-scheduled week is still there, just not all dumped on one screen at once.

## Live travel times

Departure mode can replace the manually-entered travel estimate with a live drive-time figure from Google's Routes API, factoring in current traffic. It is entirely optional — off by default, and every part of the app works without it, falling back to the travel minutes you typed in.

**One-time Google Cloud setup** (about five minutes, and free at the usage this app produces):

1. Create a project in the [Google Cloud console](https://console.cloud.google.com/).
2. Enable billing on that project — the Routes API requires a billing account even within the free tier below.
3. Enable the **Routes API** for the project (APIs & Services → Library → search "Routes API" → Enable).
4. Create an API key (APIs & Services → Credentials → Create credentials → API key).
5. **Restrict the key to the Routes API** (edit the key → API restrictions → restrict key → select "Routes API" only) — this limits what the key can be used for if it ever leaks.
6. Paste the key into Runway → Settings → Routes API key → Save, then turn on "Use live travel times".

**Free-tier note:** as of 2025's per-SKU pricing, the Routes API's `computeRoutes` call is free for the first 10,000 calls/month. Runway's usage — one manual tap in DepartureSetup plus a background refresh every 3 min (min 150 s between calls) while a single departure's Runway screen is open and running — comes to a few hundred calls a month for personal use, nowhere near that ceiling.

**The key stays on this device.** It's stored in the app's own IndexedDB (the `settings` table), never committed to the repo or baked into a build — Settings' own hint copy says so. Anyone reading this repo's source cannot see it.

**Closed-app limitation:** live travel only refreshes while the Runway screen is open and the departure is `running` (RUNWAY_PLAN.md's live-refresh hook, `src/hooks/useLiveTravel.ts`). Scheduled alarms (`src/native/notifications.ts`) are computed once, at save time, from whatever `travelMinutes` was current then — if the app is closed and a later live refresh would have changed that figure, the already-scheduled alarms still fire at the old times. This is an honest limitation, not a bug: closed-app background fetch on Android needs a foreground service or WorkManager wiring this increment doesn't add.

## Signing

The release keystore (`signing/runway.keystore`, alias `runway`) and its passwords are **committed to this repo**, along with the passwords inline in `android/app/build.gradle`. That is a deliberate, documented tradeoff, not an oversight:

- **Why:** this is a personal sideloaded app with no Play Store distribution and one installed device. A GitHub secret would need to be threaded through CI either way; committing the keystore avoids secret-management overhead for something with a narrow blast radius, in exchange for the keystore material being visible to anyone who can read this (public) repo.
- **Threat model:** anyone with read access to the repo could build and sign an APK that the phone would accept as a legitimate "update" to Runway. Exploiting that requires getting that malicious APK onto, and installed on, the unlocked phone — i.e. an attacker already needs physical access to the device. It does not expose anything remotely.
- **If this ever needs to change:** rotating away from a committed keystore means generating a **new** keystore, because this one's private key material is already public in git history and cannot be un-published by deleting the file. A new keystore signs APKs with a different signature, which Android treats as a different app for update purposes — installing it requires **uninstalling the old Runway first**, which loses any on-device Dexie data that hasn't been otherwise exported.

## Icon and splash

`assets/icon-foreground.svg` and `assets/icon-background.svg` are the source of truth for Runway's app icon and splash screens — a minimal converging-lines runway motif on a solid slate-950 background, no text. `scripts/generate-icons.mjs` rasterizes them into every Android density bucket the Capacitor template expects (`android/app/src/main/res/mipmap-*` and `drawable*/splash.png`). After changing either SVG, regenerate with:

```sh
node scripts/generate-icons.mjs
```

and re-run `npm run sync` so the Android project picks up the new PNGs. The script depends on `sharp` (devDependency) for SVG rasterization.

## Prüfung mode

A second mode alongside departure timing: exam prep for a long-lead deadline (the Facharztprüfung), full design in [`../../docs/RUNWAY_PRUFUNG_PLAN.md`](../../docs/RUNWAY_PRUFUNG_PLAN.md). One equation, recomputed live from measured data:

```
projected ready date = today + (remaining study hours ÷ measured pace in hours/week)
```

Remaining hours are the sum of each topic's (estimated − logged) hours, floored at 0 per topic. Measured pace is the rolling median of actual hours logged per week over the last 4 complete weeks — a modest, labeled 4 h/week assumption until there's real data to measure, never an aspirational number.

Work happens in **sprints**: fixed 25/50/90-minute boxes with a short start ritual, not an open-ended timer, because scheduled ignition fits the mode's motivation better than "just start working" does. **Milestones** are real external dates — a booked mock oral, a study session committed to with someone else — not self-invented checkpoints; the app renders them, it does not invent them. Each milestone gets its own mini ready-date projection scoped to the topics it covers, and a single morning-of reminder at 07:30 local on the day (or the milestone's own time if that's earlier).

Reached from Home via the quiet "Prüfung" link beside History; departure mode remains the default landing.

The exam overview also carries a next-move card: a single suggested topic and sprint length, with the reasoning that produced it always shown alongside it (recently-worked topic, or the topic furthest behind its estimate) — a suggestion with its work shown, never an oracle, and its "Start" button still runs through SprintSetup's own start ritual like every other way into a sprint. A first-open walkthrough offers a draft Facharzt Neurologie topic template when the topic list is empty; both the in-app copy and this line say the same thing — it is a starting point to correct, not a real curriculum.

There is no way to delete an exam in v1 — after the exam, starting fresh means clearing app data or waiting for v1.5's archive.

## Calendar and sharing

Two independent ways an appointment already sitting somewhere else on the phone can become a departure, without retyping it.

**Calendar read** (Home → "From your calendar"): reads the next 48 hours of timed appointments (all-day events are skipped — there's no time-of-day to plan a departure against) across every visible device calendar, capped at 3 shown at once. Each card offers "Plan departure," which opens DepartureSetup prefilled with the appointment's name and time — the destination field is left for you to fill in, even when the calendar entry has a location, since a calendar location string is often not what you'd actually type into a route search. **Nothing is ever written to the calendar** — this is read-only, full stop, and the Android permission requested (`READ_CALENDAR`) reflects that; there is no `WRITE_CALENDAR` anywhere in this app. The permission is requested lazily, only the first time you tap "Show calendar appointments here." on Home — never at app open. If you decline, the section quietly stays empty for the rest of that session (no repeated prompts); turn it back on any time from Settings → "Show calendar appointments on Home." An appointment you've already planned a departure for (any status, including an abandoned one) never resurfaces here — the point of this section is to catch what you haven't planned yet, not to nag about what you have.

**Share from Google Maps**: Runway registers as an Android share target for plain text. Tap Share on a place in Google Maps, choose Runway, and DepartureSetup opens prefilled with that place's name as the destination — the maps.app.goo.gl link Maps includes alongside the name is stripped out automatically. This works through the same `runway://` deep-link machinery the home-screen widgets already use (see below), not a separate mechanism: Android hands the shared text to `MainActivity`, which rewrites it into a `runway://share-target?...` URL before Capacitor ever sees it.

## Quick capture

A third way into DepartureSetup, alongside the calendar read and share-target above: dictate one sentence and let it become a draft. Home shows a single-line input — "Dictate a departure — name, day, time, place." — once a Gemini API key is set (see setup below); tapping the quiet "Parse" action (or pressing Enter) sends the sentence to Google's Gemini API (`gemini-2.0-flash`) and opens DepartureSetup prefilled with whatever it read: name, destination, and appointment date/time.

**It never saves anything on its own.** The parsed sentence is a draft, full stop — it always lands in DepartureSetup for you to check and explicitly save, exactly like every other way of starting a departure in this app. If no time was mentioned in the sentence, the time field is left genuinely blank (never guessed or defaulted) with a note — "No time was heard — check it." — rather than silently filling in something that was never said.

**Mixed-language dictation is the point, not an edge case.** Deepak dictates in a mix of German, English, and occasionally other languages within the same sentence — "Zahnarzt Donnerstag 14:30 in Ludwigsburg" and "dentist next Thursday at half two in Ludwigsburg" are both expected inputs, and the prompt sent to Gemini says so explicitly rather than assuming one language.

**One-time Google AI Studio setup** (about two minutes, and free at the usage this app produces):

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with a Google account.
2. **Create API key** — no billing account or Cloud project setup required for the free tier.
3. Copy the key.
4. Paste it into Runway → Settings → Quick capture → Gemini API key → Save.

**Free-tier note:** `gemini-2.0-flash` has a generous free-tier request quota, refreshed daily — Runway's usage (one explicit tap per departure you choose to dictate, nothing automatic or recurring) comes nowhere close to it for personal use.

**Privacy note:** the dictated sentence is sent to Google's Gemini API when you tap Parse — and only then. Nothing is sent automatically, on a timer, or as you type. The key itself is stored only on this device (the `settings` table), the same as the Routes API key and the field-reports token above.

## Home-screen widgets

Two 3×1 widgets, both fed from the same snapshot mechanism (see below).

**Prüfung widget** shows three lines: **"Ready by {date}"** (coloured calm/tight/late, the same thresholds as the exam overview), the exam anchor ("Exam window opens ..." or "Exam ..."), and this week's hours ("This week 1.5 of 6.5 h"). Tapping it opens straight to the Prüfung overview.

**Departure widget** (added 0.11.0) shows the next upcoming departure: its name, appointment time, and a plan line — **"Leave by 14:10 · start by 13:35"** while prep is still under way, shortening to just **"Leave by 14:10"** once every step is checked. It shows the soonest 'planned'/'running' departure whose appointment hasn't slipped more than an hour into the past (the same cutoff Home's own Upcoming/Past split uses), or **"No departure planned."** when nothing qualifies — tapping that fallback opens Home; tapping a real departure opens its live Runway screen.

**The honest staleness design:** neither widget polls or recomputes anything on its own between app opens. Everything either shows is a snapshot the app pushes explicitly — after a sprint ends, after the exam/topics/a milestone are saved, after a departure is saved/started/left/abandoned/removed or its live travel time drifts — never on a timer. Between those moments, the Prüfung widget keeps its display current in only one narrow way: the "Ready by" date is calendar-slid forward day-by-day from the day the snapshot was generated (both ends anchored to local midnight, the same whole-calendar-day rule the app's own ready-date math uses — see `src/lib/widgetSnapshot.ts`), so the *date itself* stays right even while the app is closed, and agrees with what the app would show if opened right now. Everything else on that widget — the underlying pace, the remaining hours, whether this week's line still describes the current week — is frozen at whatever it was the last time the app ran, and the this-week line disappears once the real calendar has moved past the week it was computed for. The departure widget takes a stricter line on staleness: a departure fact doesn't have a graceful "still roughly true" reading the way a ready-by date does, so rather than slide anything forward, the widget re-checks the real clock against the snapshot's appointment time on every redraw and falls back to "No departure planned." the moment more than an hour has passed since that appointment — a stale "Klinik 14:30" from a departure that's since been left, missed, or removed while the app was closed never lingers on the home screen.

**Widget expiry rules are evaluated at redraw** (roughly every 6 hours, plus every app open) — a passed appointment can linger on the widget up to that long when the app stays closed. This is an accepted tradeoff, not a bug: forcing a faster system-level redraw tick would spend battery keeping a home-screen widget current while nobody's looking at it, for a staleness window that already self-heals the moment the app is next opened.

**Add a widget:** long-press the home screen → Widgets → Runway → pick Prüfung or Departure.

**Static shortcuts** ("New departure", "Prüfung") are also available by long-pressing the app icon — no widget placement required for those.

## Field reports

A quiet "Report a problem" link on Home and on Settings opens a small form: a description (no character limit — dictate it, no need to be terse) and an optional screenshot. Saving is instant and always succeeds, whether or not you've set up syncing and whether or not the device is online — the report is written to this device's own storage first, full stop. From there it's a queue: **filed to GitHub Issues automatically once a token is configured and the device has connectivity**, retried on every app open until that happens.

**One-time GitHub setup** (a couple of minutes):

1. Go to [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens) → **Generate new token**.
2. **Repository access** → **Only select repositories** → pick the target repo (defaults to `Bosonian/Play` if you leave Settings' repo field blank — see below for pointing it somewhere else).
3. **Repository permissions** → set **Issues** to *Read and write* and **Contents** to *Read and write* (Contents is needed because screenshots upload as files in the repo before the issue that links to them is created).
4. **Generate token**, then copy it.
5. Paste it into Runway → Settings → Feedback → GitHub token → Save.

**Privacy note:** a report filed to a **public** repository — including any screenshot — is publicly visible to anyone who can see that repo. Point the target-repo field at a private repository if reports (which may show clinical-adjacent UI state, patient-facing screens excluded but appointment names and destinations included) shouldn't be visible beyond you and whoever reviews them.

**The offline queue, precisely:** a report's `status` is one of three things. `pending` means it hasn't synced yet — no token set, no connectivity, or a transient network failure — and it will keep being retried automatically, silently, with no error shown, because none of those are actually wrong. `synced` means it's a real GitHub issue now; the report list shows a link to it and the on-device screenshot copy is cleared (the bytes already live in the repo — no reason to double the storage). `failed` is different: it means GitHub rejected the request outright — bad token, bad/missing repo, a validation error — and retrying identical input would only fail identically, so it stops retrying on its own and shows GitHub's exact error instead. Fix whatever it's complaining about (usually the token or the repo field) and tap **Retry** on that report.

## v1.5 candidates

Cut from v1 deliberately, not forgotten:

- **`APP_VERSION` / `versionName` build-time injection** — right now `src/lib/appVersion.ts`'s `APP_VERSION` constant and `android/app/build.gradle`'s `versionName` are two separate hand-maintained strings (see the loud comments on both) that have to be bumped together on every release with nothing enforcing it. A build step that derives one from the other would remove that manual-sync risk.

- **Web push fallback** — a server-independent way to still get alerts if a future rebuild ever drops the native shell; much more feasible on Android than it would have been on iOS.
- **Settings deep-link plugin** — so the first-run card's battery-optimization step could open Settings → Apps → Runway → Battery directly instead of describing the path in words.
- **Live traffic while the app is closed** — the live-travel increment (see "Live travel times" above) only refreshes while the Runway screen is open; a background-fetch path (foreground service or WorkManager) that keeps `travelMinutes` current — and therefore keeps scheduled alarms current — even with the app closed is future work, not built here.
- **WorkManager-based recurring-departure materializer** — the current materializer (see "Recurring departures" above) only runs while the app is in the foreground, at open and after a template save, so its 7-day planning horizon quietly stalls if Runway goes unopened for more than a week. A native WorkManager job that can materialize (and re-arm alarms) on a schedule without the app being opened at all would remove that weekly-open requirement.
- **Weekly planning nudge** — an optional reminder to plan the coming week's sprints. Left unbuilt in v1: RUNWAY_PRUFUNG_PLAN.md §5 marks it default-OFF and borderline (it edges toward the fake-urgency pattern this mode deliberately avoids); worth reconsidering only if Deepak asks for it knowingly.
- **Exam archive / start-new-exam flow** — v1 supports exactly one exam with no delete path (see "Prüfung mode" above); needed before a second Facharzt-scale exam could ever be prepped for in this app.
- **Topic estimate suggestions (≥3 sprints per topic, ≥25% drift — suggest, never apply)** — the calibration pattern departure mode already has (`src/lib/calibration.ts`'s `computeSuggestions`) applied to topic `estimatedHours`. Cut from v1 because it needs real logged-sprint history to have any signal at all — building it before there's data to test it against would be guessing at what "meaningfully drifted" looks like in practice.

## Re-triggering a build

The APK workflow runs on any push touching `apps/runway/` (or manually via
the Actions tab's "Run workflow" button, which needs repo write access in a
browser). If a run is lost to a GitHub runner flake — job shows *cancelled*
with no failed steps — re-run it from the Actions tab, or push any change
under `apps/runway/` to start a fresh one.
