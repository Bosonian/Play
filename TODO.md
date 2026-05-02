# TODO.md

Items deliberately deferred from v1. **Do not build any of these in v1.** They live here so they're not forgotten and so the impulse to build them mid-v1 has somewhere to go.

The format: each item has a one-line description, the trigger condition (what would justify building it), and the cost-of-deferral (what's lost by waiting).

---

## v1.5 candidates — consider after 4+ weeks of v1 use

### LLM-powered reframe personalization

**What:** Replace static reframe templates (brief §7.3) with Claude API calls that generate reframes tailored to the specific task title and the user's recent reframe history.
**Trigger condition:** Static templates feel insufficient after sustained use, OR the user reports that reframes have started to feel canned.
**Cost-of-deferral:** Reframes might miss obvious better framings for unusual tasks. Mitigation: improve the static lookup table opportunistically as new task patterns emerge in real use.
**Notes:** Even if built later, the user should still *choose between* the three modes (Joker / Kinesthete / 90-second). The LLM only personalizes the suggestion within each mode; it does not pre-select the mode.

### Sunday Reflection synthesis

**What:** A "see patterns across reflections" view that surfaces themes from 8+ weeks of weekly reflection answers. Could be plain text grouping, could be LLM-summarized.
**Trigger condition:** At least 8 weekly reflections exist AND the user has visited the past-reflections list at least twice.
**Cost-of-deferral:** None until the data exists.
**Notes:** Resist the urge to build dashboards. Pattern surfacing should be in plain prose, not charts.

### Dynamic seed-pool refresh

**What:** A way to refresh the prop and scene seed pools when they get stale — either manual ("show me 10 new scene suggestions"), AI-assisted (LLM proposes based on history), or both.
**Trigger condition:** User edits the seed pool less than once a month AND skips Today's Scene more than 50% of the time over a two-week window.
**Cost-of-deferral:** Pool gets stale, ✗ rate climbs. Mitigation: ship with a generous initial pool (already done in §7).

### German UI

**What:** Full German translation, with a language toggle. User is B2–C1 in German and works in clinical German daily.
**Trigger condition:** v1 has been in stable use for 4+ weeks AND the user explicitly requests it.
**Cost-of-deferral:** None — English works fine for him in v1.

### Push notifications for Sunday Reflection

**What:** Real web push notification on Sunday at the configured time, instead of the v1 approach of surfacing the dialog when the app is next opened on/after that time.
**Trigger condition:** User reports that the open-app-to-see-dialog approach causes him to miss the Sunday Reflection consistently for 2+ weeks.
**Cost-of-deferral:** Low-to-moderate. Web push on Android Chrome (the user's device — Samsung S25 Ultra) works well from an installed PWA, requires only a service worker push handler and a permission grant. So the technical lift is smaller than originally scoped against iOS. The reason to still defer is design discipline: brief §3 says no notifications by default. Re-check that the optional-only nudge stays optional-only before adding this.
**Notes:** If built later, must remain opt-in. Default off.

### Voice-dictated capture with cleanup

**What:** A microphone button next to the capture text field that activates voice input and runs light cleanup on the dictated text before storing.
**Trigger condition:** User reports that typing capture is slowing him down, OR Wispr Flow integration becomes a friction point.
**Cost-of-deferral:** Wispr Flow already handles his dictation system-wide. Most likely never needed.

---

## Explicitly out of scope (do not build, period)

These are not v1.5 candidates. They are deliberately out of the project's scope.

### Cloud sync, multi-device, or backup-to-server

The app is single-device, local-storage. Privacy and simplicity outweigh the cross-device convenience. If the user wants the data on another device, he can use the data export feature (which itself is v1.5 if needed).

### Sharing, collaboration, or social features

Not a multi-user app. Ever.

### Streaks, badges, achievements, levels, or any gamified longitudinal tracking

These convert play into work. The brief's §11 forbids them. They will not be added.

### Productivity analytics

No "tasks completed this week," no "average reframe time," no completion-rate charts. The Sunday Reflection is the entire retrospective surface.

### Notification systems beyond the optional Sunday reflection nudge

The app has one notification surface. Don't add more.

### Calendar integration (read OR write)

The app is intentionally not a calendar. The Sunday Reflection's question 2 ("what's one scene you'd be glad to live next week?") is the entire scheduling surface. The user has Google Calendar; this app does not compete with or duplicate it.

### Reward economy / points / currency

Cut from v2 brief deliberately. Will not be re-added. If the user asks for it later, point him at this section and at the v1 brief's adversarial review for the reasoning.

### AI-driven task auto-categorization or auto-prioritization

The capture flow is one text field on purpose. Adding LLM auto-categorization at capture time bypasses the user's own self-knowledge moment, which is the thing that actually helps.

---

## Bug fixes and polish (track separately from features)

If you encounter bugs during v1 build or v1 use, log them at the bottom of this file under a `## Bugs` section. Don't mix bugs with feature deferrals — they have different urgency profiles.

## Bugs

(none yet)
