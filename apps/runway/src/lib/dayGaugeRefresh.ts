import { db } from '../db/db';
import { formatTime } from './format';
import { nextCommitment } from './dayGauge';
import { DAY_GAUGE_ENABLED_SETTING } from './dayGaugeSettings';
import { hideDayGauge, showDayGauge } from '../native/dayGauge';

/**
 * Rebuilds the day-gauge notification from the latest Dexie data — the
 * generalized form of the original "Google Maps while getting ready" hack:
 * an ambient, always-on countdown to whatever's next, glanceable in the
 * notification shade without opening the app. See DayGaugePlugin.java's own
 * header comment for the native chronometer mechanism this feeds and its
 * one honest limitation (staleness while the app stays closed past the
 * target).
 *
 * Opt-in (DAY_GAUGE_ENABLED_SETTING absent or 'false' → hide and return
 * immediately, without even reading the rest of Dexie) — CLAUDE.md's
 * "defaults lean toward less" rule; see dayGaugeSettings.ts's own comment
 * for why this is opt-in rather than on-by-default the way the home-screen
 * widgets are.
 *
 * Called explicitly from the same short, fixed list of write sites
 * `refreshWidgets` already uses, plus a `visibilitychange`-driven resume
 * hook `refreshWidgets` doesn't need (App.tsx) — see this function's own
 * call sites for exactly why: "anything that moves the widgets moves the
 * gauge" is the pairing rule (main.tsx's own call site carries the fuller
 * comment on this), because every candidate the gauge picks from
 * (departures' leaveBy, tasks' deadlines, the exam's study schedule) is
 * already exactly what the widget snapshot's own queries already read —
 * there is no write that moves one but not the other. The gauge ALSO needs
 * the resume hook because, unlike a widget (redrawn by the OS on its own
 * schedule, roughly every 6 hours), a stale chronometer has no such
 * self-healing tick at all — re-pointing it only happens when this function
 * runs, so "the app was reopened" has to be one of those triggers even
 * though nothing was necessarily written to Dexie in between.
 *
 * Never throws: same fire-and-forget contract as refreshWidgets — a gauge
 * refresh failing (no exam yet, no departures yet, a native call error,
 * notifications denied) must never surface as a failure of the screen
 * action that triggered it.
 */
export async function refreshDayGauge(): Promise<void> {
  try {
    const setting = await db.settings.get(DAY_GAUGE_ENABLED_SETTING);
    if (setting?.value !== 'true') {
      await hideDayGauge();
      return;
    }

    const now = new Date();
    const [departures, tasks, exam] = await Promise.all([
      // Same "planned or running" pool the widget snapshot's own departure
      // query reads (src/native/widgets.ts) — nextCommitment does its own
      // future-instant filtering on top, same division of labour as
      // buildWidgetSnapshot/selectUpcomingDeparture.
      db.departures.where('status').anyOf(['planned', 'running']).toArray(),
      db.tasks.where('status').anyOf(['planned', 'running']).toArray(),
      db.exams.toCollection().first(),
    ]);

    const next = nextCommitment(now, departures, tasks, exam);
    if (!next) {
      await hideDayGauge();
      return;
    }

    await showDayGauge(`Next: ${next.label} · ${formatTime(next.at)}`, next.at);
  } catch (err) {
    console.warn('Runway: failed to refresh day gauge', err);
  }
}
