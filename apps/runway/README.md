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
2. Download the `runway-v<version>-<sha>.apk` asset.
3. Open the downloaded file. The first time, Chrome will ask permission to install unknown apps — allow it for Chrome (Settings → Apps → Special access → Install unknown apps).
4. Install. Updates install over the existing app and Dexie data survives; it does **not** survive an uninstall.

## Signing

The release keystore (`signing/runway.keystore`, alias `runway`) and its passwords are **committed to this repo**, along with the passwords inline in `android/app/build.gradle`. That is a deliberate, documented tradeoff, not an oversight:

- **Why:** this is a personal sideloaded app with no Play Store distribution and one installed device. A GitHub secret would need to be threaded through CI either way; committing the keystore avoids secret-management overhead for something with a narrow blast radius, in exchange for the keystore material being visible to anyone who can read this (public) repo.
- **Threat model:** anyone with read access to the repo could build and sign an APK that the phone would accept as a legitimate "update" to Runway. Exploiting that requires getting that malicious APK onto, and installed on, the unlocked phone — i.e. an attacker already needs physical access to the device. It does not expose anything remotely.
- **If this ever needs to change:** rotating away from a committed keystore means generating a **new** keystore, because this one's private key material is already public in git history and cannot be un-published by deleting the file. A new keystore signs APKs with a different signature, which Android treats as a different app for update purposes — installing it requires **uninstalling the old Runway first**, which loses any on-device Dexie data that hasn't been otherwise exported.
