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

## v1.5 candidates

Cut from v1 deliberately, not forgotten:

- **Web push fallback** — a server-independent way to still get alerts if a future rebuild ever drops the native shell; much more feasible on Android than it would have been on iOS.
- **Settings deep-link plugin** — so the first-run card's battery-optimization step could open Settings → Apps → Runway → Battery directly instead of describing the path in words.
- **Live traffic** — replacing manually-entered travel minutes with the Google Directions API, once an API key and billing are worth setting up (RUNWAY_PLAN.md §5.6).
- **Calendar import** — read-only Google Calendar import to create departures from existing appointments instead of typing them in (RUNWAY_PLAN.md §5.6).
- **Deadline mode** — the second half of the original time-blindness problem (task-initiation procrastination, not departure timing), pointed at the same slipping-projection mechanic but anchored to a latest-safe-start time instead of an arrival time (RUNWAY_PLAN.md §8).

## Re-triggering a build

The APK workflow runs on any push touching `apps/runway/` (or manually via
the Actions tab's "Run workflow" button, which needs repo write access in a
browser). If a run is lost to a GitHub runner flake — job shows *cancelled*
with no failed steps — re-run it from the Actions tab, or push any change
under `apps/runway/` to start a fresh one.
