# Tide

Tide is the second app in this monorepo, sibling to Runway — same person,
different domain of his life. Where Runway keeps Deepak out the door on
time, Tide owns the behaviour between medical visits that moves the number
his physician actually cares about: weight, on a trend, measured honestly.
Tide is not a medical device and does not set targets — the target (and the
workup: LFTs, FibroScan) belongs to Deepak and his physician. See
`docs/TIDE_PLAN.md` at the monorepo root for the full plan, and the root
`CLAUDE.md` for the tone/copy/defaults contract both apps share.

## Increment 1 scope (this one)

A runnable web app — Vite dev server, Vitest — with no native layer yet:

- A Dexie database (`weighIns`, `meals`, `movement`, `settings`) — only
  `weighIns` has a screen this increment; the others are schema defined
  ahead of the increments that use them (TIDE_PLAN.md §7).
- The trend engine (`src/lib/trend.ts`): EMA-smoothed weight trend + slope,
  evidence-floored, pure and heavily tested. This is the app's heart.
- Four screens: Home (the trend headline), Add weigh-in (manual entry),
  History (most recent first), Settings (a stub — Health Connect and
  backup both land in later increments).

Design system primitives (`src/ui/`) are copied verbatim from
`apps/runway/src/ui/` rather than shared through a package — see each
file's header comment. A shared `ui` package across apps is a future
cleanup, not a one-increment job.

## Increment 2 scope

Capacitor + Android, mirroring Runway's own signed-APK CI workflow,
self-update checker, and activity log (backup/restore is a later
increment — see TIDE_PLAN.md §7):

- `capacitor.config.ts` / `android/` — `appId: de.bosonian.tide`. The
  manifest carries exactly one permission beyond Capacitor's own template
  defaults: `INTERNET`, for the update check below. No Health Connect
  permission yet — that's increment 3.
- `src/lib/eventLog.ts` — a local, capped (newest 2000) record of what the
  app did (app started/resumed/backgrounded, a caught screen error, a
  weigh-in saved, an update check's outcome), never what the user merely
  saw.
- `src/lib/updateCheck.ts` — checks this repo's `tide-latest` GitHub
  release every 6h (throttled), offers a Home card + a Settings "Check for
  updates" action.

See `CHANGELOG.md`'s 0.2.0 entry for the full detail, including two
judgment calls worth knowing about: Tide's release APK is signed with a
keystore **shared with Runway's own** (a deliberate, documented reuse, not
a mistake — see "Signing" below), and Tide's launcher icon is still
Capacitor's generic stock template, not yet a Tide-specific motif (see
"Icon and splash" below).

## Increment 3 scope

The Health Connect bridge — the passive-measurement unlock (TIDE_PLAN.md
§3): weight/body-fat from the Renpho scale, steps/active energy from the
Galaxy Watch, both via Samsung Health syncing into Android Health Connect,
read into Tide automatically once connected. **This is the highest-
UNVERIFIED increment yet** — see CHANGELOG.md's 0.3.0 entry's opening
paragraph and "Health Connect setup" below.

- `HealthConnectPlugin.kt` (new) — this app's first custom native plugin,
  and its first Kotlin file (Health Connect's suspend-function API made
  Kotlin the honest choice over Java; see the file's own header comment).
- `src/native/healthConnect.ts` / `src/lib/healthSync.ts` — the TS wrapper
  and Dexie-touching sync orchestrator.
- Settings' "Health Connect" section, Home's body-fat trend line and
  "Steps today" line.

See CHANGELOG.md's 0.3.0 entry for the full detail, including the exact
Gradle/manifest changes this needed and the real, load-bearing assumption
`healthSync.ts` makes about how Samsung Health timestamps a scale's
weight and body-fat readings.

## Health Connect setup

Health Connect only ever appears if something has been connected to it. On
the S25 Ultra, in this order:

1. **Renpho scale → Samsung Health**: pair the scale to Samsung Health once
   (Renpho's own app, or Samsung Health's device-pairing flow — whichever
   the scale supports; not something this app controls).
2. **Samsung Health → Health Connect**: in Samsung Health's own settings,
   there is a "Health Connect" or "Connected services" entry — turn on
   syncing for weight, body composition (body fat), steps, and active
   energy. This is a Samsung Health setting, not a Tide one; Tide has no
   way to trigger it from inside the app.
3. **Galaxy Watch → Samsung Health**: already the default pairing path for
   a Galaxy Watch; steps and active energy flow through the same Samsung
   Health → Health Connect sync as the scale once step 2 is done.
4. **Tide → Health Connect**: open Tide, Settings → "Connect health data".
   Grants Tide read-only access to whatever Samsung Health has already
   synced into Health Connect — nothing more.

**UNVERIFIED, plainly**: steps 1–3 above are Samsung Health/Renpho's own
UI, described from documentation and general Android Health Connect
behaviour, not confirmed against the actual apps on Deepak's phone. Step 4
onward (everything `HealthConnectPlugin.kt` does) has never run on a
device in this environment at all — no JDK/Android SDK here. What needs
real-device confirmation, roughly in the order it'll surface:

- Does the Gradle build even compile (`kotlinOptions.jvmTarget`, the
  `minSdk` bump, the connect-client dependency version — see CHANGELOG.md's
  0.3.0 entry for the exact lines most likely to need adjusting)?
- Does `requestHealthConnectPermissions()`'s custom `ActivityResultContract`
  registration actually launch Health Connect's consent screen and resolve
  correctly on return?
- Does a body-fat record from the Renpho scale actually land within 2
  minutes of its corresponding weight record (`healthSync.ts`'s
  `mergeBodyFat`, `BODY_FAT_MATCH_WINDOW_MS` — widened from an exact-`atMs`
  match during review specifically because that was too brittle; if even
  the 2-minute window turns out too narrow, body-fat readings will
  silently (well, logged, but invisibly to the UI) never reach the trend
  line)?
- Does the first sync's since-epoch backfill behave reasonably against
  however much history Samsung Health actually has stored?

## Running it

```
npm install
npm run dev        # Vite dev server
npm run test       # vitest run
npm run typecheck  # tsc --noEmit
npm run build      # tsc -b && vite build
npm run sync        # build + npx cap sync android
```

## Get the APK

Every push touching `apps/tide/**` rebuilds the Android APK via GitHub
Actions and refreshes a standing prerelease at:

**https://github.com/Bosonian/Play/releases/tag/tide-latest**

To install on the S25 Ultra:

1. Open that release page in Chrome on the phone.
2. Download the `tide-latest.apk` asset — the filename stays constant
   across builds, so each release replaces it rather than piling up
   sha-named files; the release body names the exact version and commit it
   was built from.
3. Open the downloaded file. The first time, Chrome will ask permission to
   install unknown apps — allow it for Chrome (Settings → Apps → Special
   access → Install unknown apps).
4. Install. Updates install over the existing app and Dexie data survives;
   it does **not** survive an uninstall.

## Signing

The release keystore (`signing/runway.keystore`, alias `runway`) is a
**verbatim copy of Runway's own keystore** — both apps are now signed with
the same key material, not two independently-minted ones. That is a
deliberate reuse, stated plainly per CLAUDE.md's "truth over reassurance"
rule:

- **Why:** generating a fresh keystore for Tide would need `keytool` to
  work reproducibly in whatever environment builds this repo — reusing an
  already-trusted, already-documented identity avoided that dependency for
  a second personal, single-device, non-Play-Store app. The keystore's
  certificate subject still reads `CN=Runway` (cosmetic — Android's
  signature check is the key material, not the certificate's subject
  fields).
- **Threat model:** identical to Runway's own (see
  `../runway/README.md`'s "Signing" section) — anyone with read access to
  this public repo could build and sign an APK either app's install would
  accept as a legitimate update. Exploiting that needs physical access to
  the unlocked phone; nothing is exposed remotely.
- **Consequence of sharing one keystore across both apps:** none beyond
  the shared blast radius above — Android's package signature check is
  scoped per `applicationId` (`de.bosonian.runway` vs `de.bosonian.tide`
  are different apps regardless of shared signing key), so this does not
  let one app impersonate the other or share its data.
- **Recommended hardening, not done here:** move both apps' keystores off
  the committed-file pattern and onto GitHub Actions secrets. Worth
  reconsidering if either app is ever shared beyond Deepak's own device.

## Icon and splash

**Known gap, flagged rather than silently shipped:** Tide's Android
launcher icon and splash screen are still Capacitor's generic stock
template (a plain blue icon), not a Tide-specific motif the way Runway has
its own converging-runway-lines icon (`apps/runway/assets/`,
`apps/runway/scripts/generate-icons.mjs`). Once both apps are installed on
the same phone, they will be visually indistinguishable in the app
drawer/recents until this is addressed. Deliberately out of this
increment's scope (see CHANGELOG.md's 0.2.0 entry) rather than built
quickly — a real motif deserves the same care Runway's got, not a rushed
placeholder. The fix, when it happens, mirrors Runway's own pattern
exactly: a `tide/assets/icon-foreground.svg` + `icon-background.svg`, a
`scripts/generate-icons.mjs` adapted from Runway's own, and
`values/ic_launcher_background.xml` updated to match.
