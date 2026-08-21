# Runway Prüfung mode — design for approval

*Deadline mode from RUNWAY_PLAN.md §8, shaped for one concrete case: the Facharztprüfung, exam window November 2026, prep starting from a July standstill. Status: **design for review — no code until approved.** Classification per your safety rules: Moderate-to-Major (new mode, new entities; departure mode untouched).*

---

## 1. What this is and is not

The departure insight at exam wavelength: a November exam is as invisible in July as a 14:30 appointment is at 09:00. Panic sprints work because urgency finally renders — weeks too late. This mode's job is to make the consequence render **now**, the same way the Runway screen does: one live number that becomes untrue in plain sight when you stall.

What it deliberately is NOT:
- **Not a fake-urgency machine.** No "you're falling behind" notifications, no streaks, no shame stats. Self-invented deadlines are discounted instantly by the brain that knows it invented them; the app will not pretend otherwise.
- **Not a steady-drip converter.** The design assumes sprints (60–90 min) are the native work unit — scheduled ignition instead of panic ignition — because that's how the user's motivation actually fires (CLAUDE.md).
- **Not a substitute for the real lever.** The highest-leverage intervention is outside the app: booked mock oral exams (Prüfungssimulationen) with real colleagues at real dates. The app renders those dates; it cannot create them.

## 2. The core mechanic

One equation, displayed enormous, recomputed from measured data:

```
projected ready date = today + (remaining study hours ÷ measured pace in hours/week)
```

- **Remaining hours** = sum over topics of (estimated hours − logged hours), floored at 0 per topic.
- **Measured pace** = rolling median of actual logged hours per week over the last 4 weeks. Before any data exists: a modest default (4 h/week), labeled as an assumption, replaced by measurement as soon as sprints are logged. Aspirational pace is never used — same principle as departure calibration.
- Centerpiece: **"Ready by 14 Dec"** next to **"Exam: Nov 2026"** with the same calm/tight/late color states (ready ≥ 2 weeks before window = calm; inside 2 weeks = tight; after window start = late).
- The actionable line beneath: **"Ready by 1 Nov needs 6.5 h/week. This week: 2.0 of 6.5."**

## 3. Entities (Dexie v3, additive)

```
Exam:        id, name, windowStart (ISO date), windowEnd?, examDate? (set when known),
             createdAt, updatedAt
Topic:       id, examId, name, estimatedHours, order
Sprint:      id, examId, topicId, plannedMinutes (25/50/90), startedAt, endedAt,
             ritual: [{name, checkedAt}], notes?  → actual minutes = endedAt − startedAt
Milestone:   id, examId, name ("Mock oral with OA Weber"), at (ISO), topicIds[]
             — real external dates only; the UI copy says so explicitly
```

Departure-mode tables untouched. Migration is additive (v2→v3), same pattern as the settings table.

## 4. Screens

1. **Exam overview** (the Prüfung home): the ready-date centerpiece + weekly line; topic list with per-topic logged/estimated hours (plain numbers, no progress bars — bars at 8% are demoralizing, numbers are just true); upcoming milestones with per-milestone mini ready-dates over their topic subset; "Start a sprint" primary action.
2. **Sprint setup** (≤3 taps): topic → length (25/50/90) → go. The start ritual is a 2–4 item checklist shown before the timer arms ("Clear desk", "Phone across the room", "Open question bank") — editable, because the first 90 seconds are the whole battle for task initiation.
3. **Sprint screen**: reuses the Runway live-screen pattern — big remaining-minutes numeral, keep-awake, one current focus line (topic name), an "End sprint" action that logs actuals. No slipping arrival here; a sprint is a fixed box. Ending early logs honestly (a 31-minute sprint is 31 minutes, not a failure state).
4. **After a sprint**: one line — "52 min on Vascular syndromes. 14.2 h remaining across all topics." Back to overview. No celebration, no guilt.

Navigation: Home gets one quiet entry point ("Prüfung") beside History. Departure mode remains the default landing.

## 5. Alarms and calibration

- **Alarms**: only two kinds, both anchored to REAL events: a morning-of reminder for milestones, and an optional weekly planning nudge (default OFF — it borders on fake urgency; the user can enable it knowingly). Sprint end uses the existing high-importance channel (a timer ringing is real, not simulated).
- **Calibration**: measured pace replaces assumed pace automatically (it's measurement, not adjustment). Topic estimate suggestions follow the departure pattern: after ≥3 sprints on a topic, if trajectory implies the estimate is off by ≥25%, suggest — never silently apply.

## 6. Build plan — 4–5 focused sessions, same loop (Sonnet codes, Fable reviews)

1. Schema v3 + exam/topic setup screens.
2. The pace math (pure, tested: median pace, ready-date projection, weekly-requirement line, empty-data behavior) + exam overview screen.
3. Sprint flow (setup, ritual, live screen, logging).
4. Milestones + their mini-projections + morning-of alarms.
5. Review round: whole-mode adversarial pass, fix, field-ready.

Rollback: revert commits; departure mode and existing data untouched throughout.

## 7. The half the app can't do (restated so it isn't lost)

Booked Prüfungssimulationen with real colleagues — roughly mid-September, mid-October, late October — are what turn "November" into a chain of near, audience-bearing deadlines the panic-sprint engine actually fires for. The exam is oral: preparing to TELL cases (localization → differential → workup → ending) is both the exam format and the Storyteller-native study mode. The app renders these dates; booking them is a calendar and a slightly awkward ask, not a feature.
