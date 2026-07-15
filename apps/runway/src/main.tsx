import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './db/db'; // import for side effect: registers the populate hook before first open
import './index.css';
import { registerNotificationNavigation } from './native/notifications';
import { registerDeepLinkNavigation } from './native/deepLinks';
import { refreshWidgets } from './native/widgets';
import { refreshDayGauge } from './lib/dayGaugeRefresh';
import { navigateToDeparture, navigateToScreen } from './lib/navigationRef';
import { materializeScheduledDepartures, materializeStudyBlockAlarms } from './lib/materialize';
import { syncPendingReports } from './lib/reportSync';
import { logEvent, pruneEventLog } from './lib/eventLog';
import { syncTransitEvents } from './lib/transitSync';

// Registered here, before the first render, rather than inside App — this
// is the earliest point in the app's lifecycle a listener can attach, which
// gives it the best chance of catching a notification tap that cold-started
// the app (see the comment on registerNotificationNavigation for the
// caveat: this is still not a guarantee, just the best available option).
// navigateToDeparture queues the navigation if App hasn't mounted yet. The
// second callback (Prüfung rework 2) is a tapped study-block alarm's
// destination — SprintSetup, prefilled via `autoSuggest` — routed through
// the same navigateToScreen queue-or-navigate helper the deep-link handler
// below already uses, rather than a departure id `registerNotificationNavigation`
// has none of for this kind of alarm.
void registerNotificationNavigation(navigateToDeparture, () =>
  navigateToScreen({ name: 'sprintSetup', autoSuggest: true }),
);

// Widgets increment: a tap on the Prüfung widget or a static home-screen
// shortcut cold-starts (or resumes) the app via a `runway://...` URL —
// registered here for the same "as early as possible" reason as the
// notification listener above. Unlike that one, this also reliably catches
// the cold-start case itself (see registerDeepLinkNavigation's doc comment
// for why @capacitor/app's getLaunchUrl makes that reliable here).
void registerDeepLinkNavigation(navigateToScreen);

// Fire-and-forget: refreshes the home-screen widget from whatever's
// currently in Dexie, so it isn't left showing data from before the app was
// last closed. Never blocks the first render — see refreshWidgets' own doc
// comment for the full list of call sites and why an explicit list beats a
// generic Dexie hook.
void refreshWidgets();

// Day-gauge increment (0.31.0): the pairing rule for this whole increment —
// "anything that moves the widgets moves the gauge." Every candidate
// refreshDayGauge picks from (a departure's leaveBy, a task's deadline, the
// exam's next study block) is already exactly what buildWidgetSnapshot's own
// queries already read, so there is no Dexie write that changes one but not
// the other — every refreshWidgets() call site in this codebase gets a
// refreshDayGauge() call beside it for that reason (see refreshDayGauge's own
// doc comment for the one call site it needs that refreshWidgets doesn't: a
// visibilitychange resume hook in App.tsx, since a widget self-heals on the
// OS's own ~6-hourly redraw tick and a chronometer notification does not).
// This is the only one of those paired call sites carrying this comment —
// the rest are left uncommented so the pairing reads as a rule, not N
// separate one-off justifications.
void refreshDayGauge();

// Recurring-departures increment: plans the next HORIZON_DAYS of scheduled
// departures (and sweeps stale auto-created ones) on every app open — see
// materialize.ts's own doc comment for why this runs here as well as after
// a TemplateEdit save, and for the "weekly open keeps alarms armed" caveat
// this fire-and-forget call carries. Placed after refreshWidgets rather
// than before it: materializeScheduledDepartures does its own widget
// refresh internally once it knows whether anything actually changed, so
// ordering relative to the unconditional call above doesn't matter, but
// keeping the two Dexie-reading startup calls adjacent makes this list
// easier to scan.
void materializeScheduledDepartures();

// Prüfung rework 2 (armed study blocks): the same "re-run on every open"
// shape as materializeScheduledDepartures directly above, for the exam's
// studySchedule instead of a template's — see materialize.ts's own doc
// comment on materializeStudyBlockAlarms for why it's a full
// cancel-and-reschedule rather than a missing-occurrence diff (there's no
// row to diff against; see notifications.ts's scheduleStudyBlockAlarms for
// the "no ledger table" decision). Placed after the departure materializer
// for readability (the two Dexie-reading startup calls stay adjacent), not
// because ordering between them matters.
void materializeStudyBlockAlarms();

// Field-reports increment: retries whatever's still `status: 'pending'` in
// the fieldReports table against GitHub Issues, same fire-and-forget
// treatment as the two calls above — never blocks the first render, never
// throws (see reportSync.ts's own doc comment), and picking up the queue on
// every app open is what makes offline capture eventually consistent
// without any background sync worker.
void syncPendingReports();

// Activity-log increment: prune-on-open, beside the other startup
// materializers — see pruneEventLog's own doc comment for why one cheap
// pass here beats a count-and-maybe-delete after every single logEvent
// call. Logged AFTER the prune call is issued (not awaited first) so
// "App started." is always the earliest line for this session even though
// the prune itself resolves asynchronously.
void pruneEventLog();
void logEvent('lifecycle', 'App started.');

// Car Bluetooth transit increment (0.36.0): reads whatever
// BluetoothTransitReceiver.java has recorded since the last sync, matches it
// against departures, and merges new measurements into Dexie — same
// fire-and-forget, run-on-every-open shape as the materializers above. A
// no-op on web and on any phone with no watched car configured yet (see
// transitSync.ts's own doc comment for why this never throws).
void syncTransitEvents();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
