# Fixed-target check-in and medicine OCR acceptance

> Device checklist originally written for 0.16.0 / tapping v3. Current application: 0.16.2 / build 21, tapping v4 with feedback. Read [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md) and [TAPPING_FEEDBACK.md](TAPPING_FEEDBACK.md) for current status. Historical build commands, test counts and release status below are not current release instructions. Outstanding device checks remain outstanding unless later evidence is recorded.

## Implemented increment

- Tapping protocol v3: ten seconds per hand, fixed equal targets, self-paced
  alternation with either side allowed first, left then right using one index finger.
- ON, OFF, ON with dyskinesia, or uncertain selection before the test; one state
  event and two hand records saved atomically with stable retry identity.
- Doctor-set 30-minute, 1-hour, 2-hour, 4-hour or custom check-in times within an
  explicit daily window and timezone. Android alarms are inexact.
- Optional Android Cloud Vision EU medicine OCR with native encrypted API-key
  configuration, bounded metadata-free image preparation and explicit review.
- Unsupported or qualified prescriptions use reviewed free text, with no generated
  daily dose slots. No automatic prescribing or treatment inference.

## Required installed-device checks

These checks require the built app on an Android device; automated unit checks do
not establish them. Use fabricated medication lists before any patient document.

1. Upgrade an existing local debug-signed installation and verify prior diary and
   regimen records survive. Release-signed installations need their matching key.
2. Start a study, enable notifications, verify allow/deny/settings and blocked-channel
   states. Compare the saved plan and next scheduled notification.
3. Tap a notification from a closed app, background app, visible app and while another
   entry is in progress. Confirm the exact combined flow, no interrupted test and no
   duplicate occurrence. Check cancellation, expiry, reboot and timezone changes.
4. Complete both hand tests in each reported state; try repeated target/outside taps,
   simultaneous fingers, page hiding, rotation, unable hand and failed-save retry.
   Confirm separate sides and identical state/session linkage.
5. Save, reload, replace and remove a restricted Vision API key. Test its generated
   non-patient image, then a fabricated list. Verify the EU endpoint and controlled
   failures with invalid credentials, offline operation and cancellation.
6. Inspect a full-page source at zoom. Compare decimal comma/point, combination
   strengths, release formulation, PRN conditions, negation and weekday restrictions.
   Confirm no medicine is added before all review confirmations and final apply.
7. With synthetic data only, confirm logcat contains no image bytes, OCR text or key.

## Evidence boundary

Protocol v3 is inspired by the fixed alternating-target smartphone study:
https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0158852

The study used fixed physical geometry and three trials per hand. This app uses
responsive targets and one trial per hand. Its outputs are descriptive observations,
not a validated bradykinesia score, MDS-UPDRS score or objective ON/OFF classifier.
The changing-target task was removed from the primary measurement; historical
protocol v2 results keep their version and must not be pooled without qualification.

The remote doctor dashboard, multi-patient authentication, synchronization, and
production hosting remain separate future work.

## Automated validation for 0.16.0 / local build 6

Full Vitest suite: 322/322 tests across 35 files passed. TypeScript checking and
production web build passed. Astra approved the code review; a subsequent reminder
performance review passed 9/9 focused tests. Android build results are recorded in
CHECKIN_OCR_DELIVERY.md. The physical-device checks above remain unperformed.
