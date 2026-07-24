# Runway — research and v1 plan

*A time-perception app for getting out the door. Working title: **Runway** (the getting-ready window is a runway; the plane leaves whether you're strapped in or not). Rename freely.*

*Revision 2: v1 ships as an installable Android APK (Capacitor shell around the web app) instead of a plain PWA, per your request. This upgrades notifications from "reliable only while the app is open" to real alarm-clock-grade scheduled alarms. Sections 5.5, 6 and 7 changed; the research and core mechanic are untouched.*

**Status: built.** v1 (0.5.0) is implemented in `apps/runway/` per this plan — six increments plus a whole-app adversarial review round. The §9 questions were answered: name Runway, sub-app in this repo, committed keystore (see `apps/runway/README.md` for the tradeoff), scope as drawn. Remaining before calling it 1.0.0: the on-device field test (§7 session 6 checkpoint), including the cold-start notification-tap case flagged in `src/native/notifications.ts`.

---

## 1. The problem, stated precisely

Two distinct failure modes, one shared cause:

1. **Chronic lateness to appointments** — leaving the house later than the situation requires.
2. **Deadline procrastination** — starting tasks only when urgency finally arrives.

The shared cause is **time blindness** (the research literature calls it impaired time reproduction/estimation): the internal clock that lets neurotypical people *feel* "20 minutes have passed" runs unreliably in ADHD. Findings from a decade of adult-ADHD studies ([MDPI review, 2023](https://www.mdpi.com/1660-4601/20/4/3098); [PubMed](https://pubmed.ncbi.nlm.nih.gov/36833791/)) show deficits in time reproduction and estimation, worse under distraction, and closely tied to working memory — consistent with Barkley's 1997 model. Notably, medication does not reliably fix timing accuracy. Two practical consequences:

- **Durations are invisible.** "This takes 30 minutes" carries almost no felt meaning.
- **The future is flat.** An appointment at 14:30 feels equally distant at 09:00 and at 13:55 — until suddenly it's *now*, and now has urgency, and urgency finally produces action. This is why you function at the last moment: the last moment is the only moment your brain renders in high resolution.

**Scope decision:** v1 targets failure mode 1 only (appointments/leaving). Deadline procrastination is a different mechanism (task initiation, not departure timing) and bolting both into one app would blur it. It's listed as a v2 direction in §8.

## 2. Why the Google Maps trick works

The hack you heard about: start Google Maps navigation to your destination *while still getting ready*. Every minute you dawdle, the "Arrive 14:42" figure visibly slips later. It works because it converts time from the form ADHD brains can't read into the form they can:

| Weak signal (invisible) | Strong signal (what Maps provides) |
|---|---|
| A duration: "you have 25 min" | A concrete future event: "you will arrive at 14:42" |
| Static — told once, then forgotten | **Live** — updates every minute, re-enters awareness |
| Abstract, no stakes | Consequence is visible *while you can still act on it* |

This matches the standard clinical advice for time blindness — externalize time, make it ambient, anchor to events rather than durations ([ADDA](https://add.org/adhd-time-blindness/), [Tiimo on time agnosia](https://www.tiimoapp.com/resource-hub/adhd-time-agnosia-strategies)) — but Maps does it with a feedback loop instead of a one-shot alarm.

Its limitation, and the app's reason to exist: **Maps only knows about the drive.** It assumes you're ready to leave now. It knows nothing about the shower, the clothes, the bag, the "where are my keys" tax. So the arrival estimate is a lie until the moment you actually step out — which is exactly the part that goes wrong ([Verne Wellness on the departure-time trap](https://www.vernewellness.com/post/5-adhd-time-traps-how-to-conquer-them)). Runway extends the slipping-ETA feedback loop backwards through the getting-ready process itself.

## 3. What already exists (and the gap)

- **[Lately](https://www.getlately.app/)** — "be on time" app for ADHD; leave-by reminders at 30/10/5 min plus gamified points ([TechCrunch](https://techcrunch.com/2025/04/26/latelys-new-gamified-app-helps-people-arrive-on-time/)). Closest to this idea. iOS-first, subscription, and reminder-based — it tells you when to leave but doesn't model your prep or show a live arrival projection while you get ready.
- **[Tiimo](https://www.tiimoapp.com/)** — visual day planner with per-activity countdown rings. Whole-day planning tool, not a departure tool.
- **[Routinery](https://www.getinflow.io/post/best-alternatives-tiimo-adhd)** / **[Brili](https://brili.com/)** — step-by-step routine timers (shower 15 → dress 10 → …). Good step mechanics, but anchored to routine start, not to an arrival deadline; nothing slips visibly when you overrun.

**The gap Runway fills:** backwards-planning from the appointment, *through* your prep steps, rendered as one live, slipping arrival time. Plus it's yours: local-only, no account, no subscription, calm.

## 4. The core mechanic

One equation, recomputed every few seconds, displayed enormous:

```
projected arrival = now
                  + sum of remaining (unchecked) prep steps
                  + friction buffer
                  + travel time
```

- Projected arrival ≤ appointment time → calm state. The screen just breathes.
- You dawdle → `now` advances while "remaining prep" doesn't shrink → the arrival figure visibly drifts past the appointment time. No siren, no red flash panic — the number simply becomes untrue-to-your-intention in plain sight, the same quiet dread the Maps ETA produces.
- You check off a step → projection snaps back toward reality. Checking off is the only way to pull the number back, which is what makes the checklist get used.

This is the whole app. Everything else is setup for this screen or learning from it.

## 5. v1 scope

### 5.1 Departures (setup, under 30 seconds for a repeat outing)

A **departure** = destination name, appointment time (24h), travel minutes, prep routine, buffer.

- **Travel minutes are entered manually** — you glance at Google Maps once and type the number. Deliberate: the Google Directions API needs an API key and billing, which violates the ask-first rule and adds a server dependency. v1 gets a "check route in Maps" deep link to make the glance one tap. Honest tradeoff: the travel figure won't auto-update with live traffic; the buffer absorbs ordinary variance.
- **Templates** ("Klinik", "piano lesson", "airport"): saved destination + travel time + routine. Repeat outings become: pick template, set time, done. Entry friction is where ADHD tools die, so this is v1, not v1.5.
- **Prep routine** = ordered steps with minute estimates (shower 15, dress 10, pack bag 5, shoes & door 5). One default template ships; fully editable.
- **Friction buffer**, default 10 min, visible and labeled honestly ("keys, toilet, one more thing") — not hidden padding, because hidden padding gets mentally subtracted.

### 5.2 The Runway screen (the live view)

- Giant projected arrival time next to the appointment time; state legible at a glance from across the room while you get ready.
- Current step with its remaining minutes; remaining steps stacked below; tap to check off.
- Overrun on the current step shows as slip on the arrival figure — the connection between "I'm still in the shower" and "I arrive late" is rendered, not inferred.
- **Wake Lock API** keeps the screen on (phone propped on the dresser = ambient clock, the Maps usage pattern).
- Color shifts calm → warning across the on-time boundary. No sounds in v1 except the staged alerts below.

### 5.3 Leave-now and the handoff

- "Leave now" state when remaining prep hits zero-or-overdue: full-screen, unambiguous.
- One tap opens Google Maps navigation via URL scheme (`google.com/maps/dir/?api=1&destination=…`) — no API key needed. Runway hands off to Maps at the door; Maps does what it's good at.
- One more tap on the way out: **"I'm out the door"** — timestamps the actual departure for calibration.

### 5.4 Calibration (the part that compounds)

Time optimism doesn't fix itself; the app should learn your real numbers:

- Per-step actuals are captured free from check-off timestamps.
- After each departure: actual vs. planned out-the-door time, and one optional tap on arrival ("early / on time / late by ~X").
- After 3+ runs of a template: "You plan 10 min to dress; your median is 16. Update the estimate?" — suggestion, never silent adjustment.
- History view: last 10 departures, planned vs. actual, median slip. Plain numbers, no charts, no streaks, no shame mechanics. (Self-Competitor gets "on time 4 of your last 5" — a quiet score, not confetti.)

### 5.5 Alerts — full alarm-grade, because we ship an APK

Staged notifications ("start getting ready" / "wrap up" / "leave in 5" / "leave now") multiply the chance of transitioning at the right moment ([ADDA](https://add.org/adhd-time-blindness/)). The original plan's biggest weakness was that a plain PWA can't reliably fire alarms while closed. Shipping as a native APK (Capacitor shell, §6) removes that weakness:

- Alarms are scheduled natively via [`@capacitor/local-notifications`](https://capacitorjs.com/docs/apis/local-notifications) with `allowWhileIdle: true` so they fire through Doze, app closed or not.
- The manifest declares [`USE_EXACT_ALARM`](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms) — the Android 14+ permission for apps whose *core function* is alarms, which is exactly what this is. No runtime permission dance; sideloading also means no Play Store policy review of that claim.
- "Leave now" gets its own high-importance notification channel: sound + strong vibration, distinct from the gentler staged ones. You choose the sounds once in Android's channel settings.
- Two honest caveats: (1) Android lets users disable exact alarms per-app in system settings; if that happens, scheduled exact alarms are silently dropped — the app checks `checkExactNotificationSetting()` on launch and tells you rather than failing quietly. (2) Aggressive battery optimizers (Samsung's included) can defer even exact alarms; first-run setup will include a one-time "exclude from battery optimization" prompt.

So in v1: setting up tomorrow's departure tonight and getting woken into the getting-ready window by the app itself — works, phone in pocket, app closed.

### 5.6 Explicitly not in v1

- Deadline/task procrastination features (v2 direction, §8)
- Live traffic / Directions API (needs key + billing — ask-first)
- Calendar integration (v1.5 candidate; read-only Google Calendar import is genuinely useful but adds OAuth)
- Accounts, sync, social anything, streaks, gamified points à la Lately
- iOS polish beyond "works in Safari" — primary target is the S25 Ultra

## 6. Tech and repo

**Stack (needs your explicit sign-off): the web stack already proven in this repo, wrapped in a native Android shell.**

- **App code:** React 18 + TypeScript + Vite + Tailwind + Dexie (IndexedDB) — identical to head-in. All the logic, screens and storage are ordinary web code.
- **Android shell: [Capacitor](https://capacitorjs.com/).** Capacitor wraps the built web app in a real Android project (a WebView plus native plugin bridges) and produces a normal APK. Chosen over the alternatives deliberately: full-native Kotlin would abandon the stack you already have working; React Native/Flutter are new stacks entirely; a plain PWA can't do closed-app alarms; a TWA wrapper is still bound by web-notification limits. Capacitor keeps ~95% of the code as plain web and buys native power exactly where needed:
  - `@capacitor/local-notifications` — exact, Doze-proof scheduled alarms (§5.5)
  - `@capacitor/haptics` — vibration patterns
  - `@capacitor-community/keep-awake` — screen-on during the Runway view
  - Maps handoff via the same `google.com/maps/dir/` URL, which Android routes to the Maps app
- **Bonus, free:** the same codebase still runs in any browser (`npm run dev`, or a Pages deploy later for Mac use). Develop and test in the browser; ship the APK.

**How you get the APK — no Android Studio on your machine.** A GitHub Actions workflow builds the APK on every push to the release branch (Ubuntu runners ship the Android SDK) and attaches it to a GitHub Release. On your S25 Ultra: open the release page, download, install (Android will ask once to allow installs from Chrome). Updates = download the new APK over the old one; Dexie data survives updates because it lives in the app's WebView storage, though it does **not** survive uninstall — worth knowing before ever "reinstalling to fix something."

**APK signing — one decision needed.** Android requires every APK to be signed, and *updates must carry the same signature* or the phone refuses to install over the old version.
1. **Keystore in a GitHub Actions secret (recommended):** I generate the keystore, you paste one base64 string into the repo's secrets (two-minute task, I'll give exact steps). Standard, safe.
2. **Keystore committed to the repo:** zero setup, but this repo is public — anyone could sign an APK that your phone would accept as an "update" to Runway. Real-world risk for a personal sideloaded app is small (they'd still need your phone), but it's a corner I'd rather not cut silently.

**Repo layout — needs your call.** This repo (`Play`) currently *is* the head-in app. Options:

1. **Separate repo (`bosonian/runway` or similar) — recommended**, now even more clearly: a Capacitor project carries an entire `android/` Gradle tree plus its own CI workflow, which would sit heavily inside head-in's repo. Needs you to create the repo and add it to a session.
2. **Sub-app in this repo** (`apps/runway/` with its own package.json and workflow) — works today with no new access; main risks are workflow clutter and accidentally entangling head-in's deploy.

## 7. Build plan — six focused sessions

Each ≈ one 60–90 min window, each ends with something visibly working. Classification per your scale: the whole build is a **Moderate** change (new app, no existing code touched under repo option 1) — hence this approval gate.

1. **Skeleton + data model.** App shell, Dexie schema (departures, templates, steps, run logs), departure setup screen with template pick. Browser-only this session. *Checkpoint: create a departure in the browser.*
2. **Runway screen.** The projection equation, live updates, step check-off, slip rendering, calm/warning states. *Checkpoint: the number visibly slips when you ignore it — the Maps effect, reproduced.*
3. **APK pipeline.** Capacitor scaffold (`android/` project), signing setup, GitHub Actions workflow building a release APK. *Checkpoint: you download an APK from GitHub and the app from sessions 1–2 runs installed on the S25 Ultra.* Deliberately early — installing on the real phone needs to work before behavior gets built on top of it.
4. **Alarms + leave-now.** Native staged alarms (exact, Doze-proof), notification channels, battery-optimization prompt, leave state, Maps handoff, keep-awake, "I'm out the door" logging. *Checkpoint: phone in pocket, app closed, alarms fire on time; full dry run against a fake appointment.*
5. **Calibration.** Per-step actuals, post-run summary, estimate-update suggestions, 10-departure history. *Checkpoint: app proposes a corrected estimate after three runs.*
6. **Polish + field test.** Icon, splash, first-run setup flow, rough edges from the dry runs, then a real appointment. *Checkpoint: used for one real departure, and you left on time — or the log shows exactly where it broke down.*

Rollback story is trivial under repo option 1 (delete the repo, uninstall the APK) and stays trivial under option 2 (revert the branch; head-in untouched on `main`).

## 8. v2 direction, noted and parked

The deadline-procrastination half of your original problem could reuse the same core mechanic pointed at tasks: "for the report to be done by Friday 17:00, drafting must start by Wednesday 14:00" — a slipping *latest-safe-start* time instead of a slipping arrival time. Same equation, different anchor. Parked because task initiation has failure modes departure doesn't (no physical door to walk out of), and v1 needs to prove the mechanic on the easier case first.

## 9. Questions needing your answer before code

1. **Stack:** React/Vite/Dexie/Tailwind wrapped in Capacitor, APK built by GitHub Actions — approved?
2. **Repo:** separate repo (recommended) or sub-app inside `Play`?
3. **Signing:** keystore as a GitHub secret (recommended, one two-minute task for you) or committed to the repo (zero setup, weaker)?
4. **Name:** Runway — keep, or rename?
5. **v1 scope as drawn** (departures only, manual travel minutes) — approved, or is any cut too deep?

---

*Sources: [ADDA on time blindness](https://add.org/adhd-time-blindness/) · [Time Perception in Adult ADHD: A Decade in Review (MDPI 2023)](https://www.mdpi.com/1660-4601/20/4/3098) · [PubMed entry](https://pubmed.ncbi.nlm.nih.gov/36833791/) · [Frontiers: perceptual timing deficit in ADHD](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2017.00122/full) · [Verne Wellness: 5 ADHD time traps](https://www.vernewellness.com/post/5-adhd-time-traps-how-to-conquer-them) · [Lately](https://www.getlately.app/) ([TechCrunch coverage](https://techcrunch.com/2025/04/26/latelys-new-gamified-app-helps-people-arrive-on-time/)) · [Tiimo](https://www.tiimoapp.com/) · [Tiimo: time agnosia strategies](https://www.tiimoapp.com/resource-hub/adhd-time-agnosia-strategies) · [Brili](https://brili.com/) · [Inflow: Tiimo alternatives incl. Routinery](https://www.getinflow.io/post/best-alternatives-tiimo-adhd)*
