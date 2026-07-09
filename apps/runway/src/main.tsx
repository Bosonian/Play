import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './db/db'; // import for side effect: registers the populate hook before first open
import './index.css';
import { registerNotificationNavigation } from './native/notifications';
import { registerDeepLinkNavigation } from './native/deepLinks';
import { refreshWidgets } from './native/widgets';
import { navigateToDeparture, navigateToScreen } from './lib/navigationRef';
import { materializeScheduledDepartures } from './lib/materialize';
import { syncPendingReports } from './lib/reportSync';

// Registered here, before the first render, rather than inside App — this
// is the earliest point in the app's lifecycle a listener can attach, which
// gives it the best chance of catching a notification tap that cold-started
// the app (see the comment on registerNotificationNavigation for the
// caveat: this is still not a guarantee, just the best available option).
// navigateToDeparture queues the navigation if App hasn't mounted yet.
void registerNotificationNavigation(navigateToDeparture);

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

// Field-reports increment: retries whatever's still `status: 'pending'` in
// the fieldReports table against GitHub Issues, same fire-and-forget
// treatment as the two calls above — never blocks the first render, never
// throws (see reportSync.ts's own doc comment), and picking up the queue on
// every app open is what makes offline capture eventually consistent
// without any background sync worker.
void syncPendingReports();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
