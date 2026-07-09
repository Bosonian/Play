# Runway — research and v1 plan

*A time-perception app for getting out the door. Working title: **Runway** (the getting-ready window is a runway; the plane leaves whether you're strapped in or not). Rename freely.*

**Status: plan for review. Nothing is built yet.** Per your safety preferences this document is the "explain the plan in plain English before executing" step, and it ends with the questions that need your explicit approval before any code is written.

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

### 5.5 Alerts — with an honest platform limitation

Staged notifications ("start getting ready" / "wrap up" / "leave in 5" / "leave now") multiply the chance of transitioning at the right moment ([ADDA](https://add.org/adhd-time-blindness/)). On Android Chrome as a PWA:

- **App open (even screen-locked with wake lock): fully reliable.** Timers + Notification API + vibration work.
- **App closed: not reliable.** Scheduled local notifications without a push server aren't dependable in PWAs. **v1 therefore does not promise closed-app alarms.** Mitigations: (a) the intended usage is Maps-style — open the app when you start getting ready, prop the phone up; (b) an "add leave-by alarm to clock" helper for the start-getting-ready moment; (c) real web push via a small server is the flagship v1.5 item — same infrastructure the PlayDHD TODO already earmarks for the Sunday Reflection nudge.

This is the plan's biggest limitation and I'd rather name it now than have you discover it standing in the shower. The app's value proposition works *within* the getting-ready window; getting you *into* that window still leans on a clock alarm in v1.

### 5.6 Explicitly not in v1

- Deadline/task procrastination features (v2 direction, §8)
- Live traffic / Directions API (needs key + billing — ask-first)
- Calendar integration (v1.5 candidate; read-only Google Calendar import is genuinely useful but adds OAuth)
- Accounts, sync, social anything, streaks, gamified points à la Lately
- iOS polish beyond "works in Safari" — primary target is the S25 Ultra

## 6. Tech and repo

**Stack (needs your explicit sign-off): the exact stack already in this repo** — React 18 + TypeScript + Vite + Tailwind + Dexie (IndexedDB) + `vite-plugin-pwa`, deployed as an installable PWA on GitHub Pages. Rationale: it's proven on your phone with head-in, local-only storage suits the no-account design, and no new tooling to learn or babysit. The one genuinely new API surface is Wake Lock + Notifications, both plain web APIs.

**Repo layout — needs your call.** This repo (`Play`) currently *is* the head-in app (one Vite build at `/Play/`). Options:

1. **Separate repo (`bosonian/runway` or similar), same stack** — cleanest: own deploy, own PWA manifest, own icon on your home screen, no risk to head-in. Cost: a few minutes of repo/Pages setup. **Recommended.**
2. **Second Vite app in this repo** (e.g. `apps/runway/` built to `/Play/runway/`) — one repo to rule them all, but the deploy workflow and PWA scoping (two service workers under one origin path) get fiddly, and a Runway mistake can break head-in's deploy.

Option 1 is better engineering; it just needs you to create the repo and grant access. Option 2 works today with no new access.

## 7. Build plan — five focused sessions

Each ≈ one 60–90 min window, each ends with something visibly working. Classification per your scale: sessions 1–5 together are a **Moderate** change (new app, no existing code touched under option 1) — hence this approval gate.

1. **Skeleton + data model.** App shell, Dexie schema (departures, templates, steps, run logs), departure setup screen with template pick. *Checkpoint: create a departure on your phone.*
2. **Runway screen.** The projection equation, live updates, step check-off, slip rendering, calm/warning states. *Checkpoint: the number visibly slips when you ignore it — the Maps effect, reproduced.*
3. **Leave-now + handoff.** Leave state, Maps deep link, wake lock, "I'm out the door" logging, in-app staged alerts with vibration. *Checkpoint: full dry run against a fake appointment.*
4. **Calibration.** Per-step actuals, post-run summary, estimate-update suggestions, 10-departure history. *Checkpoint: app proposes a corrected estimate after three runs.*
5. **PWA + deploy.** Manifest, icons, install flow, Pages workflow, real-appointment field test. *Checkpoint: installed icon on the S25 Ultra, used for one real appointment.*

Rollback story is trivial under repo option 1 (delete the repo) and stays trivial under option 2 (revert the branch; head-in untouched on `main`).

## 8. v2 direction, noted and parked

The deadline-procrastination half of your original problem could reuse the same core mechanic pointed at tasks: "for the report to be done by Friday 17:00, drafting must start by Wednesday 14:00" — a slipping *latest-safe-start* time instead of a slipping arrival time. Same equation, different anchor. Parked because task initiation has failure modes departure doesn't (no physical door to walk out of), and v1 needs to prove the mechanic on the easier case first.

## 9. Questions needing your answer before code

1. **Stack:** the existing React/Vite/Dexie/Tailwind PWA stack — approved?
2. **Repo:** separate repo (recommended) or sub-app inside `Play`?
3. **Name:** Runway — keep, or rename?
4. **v1 scope as drawn** (departures only, manual travel minutes, no closed-app alarms) — approved, or is any cut too deep?

---

*Sources: [ADDA on time blindness](https://add.org/adhd-time-blindness/) · [Time Perception in Adult ADHD: A Decade in Review (MDPI 2023)](https://www.mdpi.com/1660-4601/20/4/3098) · [PubMed entry](https://pubmed.ncbi.nlm.nih.gov/36833791/) · [Frontiers: perceptual timing deficit in ADHD](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2017.00122/full) · [Verne Wellness: 5 ADHD time traps](https://www.vernewellness.com/post/5-adhd-time-traps-how-to-conquer-them) · [Lately](https://www.getlately.app/) ([TechCrunch coverage](https://techcrunch.com/2025/04/26/latelys-new-gamified-app-helps-people-arrive-on-time/)) · [Tiimo](https://www.tiimoapp.com/) · [Tiimo: time agnosia strategies](https://www.tiimoapp.com/resource-hub/adhd-time-agnosia-strategies) · [Brili](https://brili.com/) · [Inflow: Tiimo alternatives incl. Routinery](https://www.getinflow.io/post/best-alternatives-tiimo-adhd)*
