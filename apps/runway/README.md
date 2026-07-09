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

## v1.5 candidates

Cut from v1 deliberately, not forgotten:

- **Web push fallback** — a server-independent way to still get alerts if a future rebuild ever drops the native shell; much more feasible on Android than it would have been on iOS.
- **Settings deep-link plugin** — so the first-run card's battery-optimization step could open Settings → Apps → Runway → Battery directly instead of describing the path in words.
- **Live traffic while the app is closed** — the live-travel increment (see "Live travel times" above) only refreshes while the Runway screen is open; a background-fetch path (foreground service or WorkManager) that keeps `travelMinutes` current — and therefore keeps scheduled alarms current — even with the app closed is future work, not built here.
- **Calendar import** — read-only Google Calendar import to create departures from existing appointments instead of typing them in (RUNWAY_PLAN.md §5.6).
- **Weekly planning nudge** — an optional reminder to plan the coming week's sprints. Left unbuilt in v1: RUNWAY_PRUFUNG_PLAN.md §5 marks it default-OFF and borderline (it edges toward the fake-urgency pattern this mode deliberately avoids); worth reconsidering only if Deepak asks for it knowingly.
- **Exam archive / start-new-exam flow** — v1 supports exactly one exam with no delete path (see "Prüfung mode" above); needed before a second Facharzt-scale exam could ever be prepped for in this app.
- **Topic estimate suggestions (≥3 sprints per topic, ≥25% drift — suggest, never apply)** — the calibration pattern departure mode already has (`src/lib/calibration.ts`'s `computeSuggestions`) applied to topic `estimatedHours`. Cut from v1 because it needs real logged-sprint history to have any signal at all — building it before there's data to test it against would be guessing at what "meaningfully drifted" looks like in practice.

## Re-triggering a build

The APK workflow runs on any push touching `apps/runway/` (or manually via
the Actions tab's "Run workflow" button, which needs repo write access in a
browser). If a run is lost to a GitHub runner flake — job shows *cancelled*
with no failed steps — re-run it from the Actions tab, or push any change
under `apps/runway/` to start a fresh one.
