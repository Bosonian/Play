# Runway changelog

Versions map to `versionName` in `android/app/build.gradle`. Install always
via the `runway-latest.apk` asset at
https://github.com/Bosonian/Play/releases/tag/runway-latest — it carries
whichever version built last.

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
