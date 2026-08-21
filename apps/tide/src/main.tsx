import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './db/db'; // import for side effect: opens the database before first render
import './index.css';
import { logEvent, pruneEventLog } from './lib/eventLog';
import { checkForUpdate } from './lib/updateCheck';
import { syncHealthData } from './lib/healthSync';
import { syncPendingReports } from './lib/reportSync';
import { refreshWidgets } from './lib/widgets';

// Increment 2: prune-on-open, mirroring main.tsx's own comment in Runway —
// one cheap pass here beats a count-and-maybe-delete after every single
// logEvent call. Logged AFTER the prune call is issued (not awaited first)
// so "App started." is always the earliest line for this session even
// though the prune itself resolves asynchronously.
void pruneEventLog();
void logEvent('lifecycle', 'App started.');

// Self-update check (increment 2): same fire-and-forget, run-on-every-open
// shape as the log calls above — checkForUpdate's own 6h throttle (not a
// call-site guard here) is what keeps this from hitting GitHub's API on
// every single app open; see updateCheck.ts's doc comment. Never blocks the
// first render, never throws.
void checkForUpdate();

// Health Connect bridge increment (0.3.0): same fire-and-forget, run-on-
// every-open shape as the calls above. `syncHealthData` itself no-ops
// immediately (before any native call) unless Settings' "Connect health
// data" has already been used once — see that function's own doc comment —
// so this is a cheap no-op on every open until Deepak actually connects it.
// Widget increment (0.9.0): refreshWidgets() runs again once this resolves,
// so a sync that pulled in a new scale reading updates the widget without
// waiting for Deepak to open the app a second time.
void syncHealthData().then(() => void refreshWidgets());

// Widget increment (0.9.0): an unconditional refresh at app start, on top
// of the syncHealthData-chained one above — a widget left showing
// yesterday's (or an even older) snapshot should catch up to whatever's
// already in Dexie the moment the app opens, not wait on a Health Connect
// sync that may no-op entirely (Health Connect not connected) or take a
// moment to resolve. Redundant with the chained call above on a device
// where Health Connect IS connected (both end up pushing the same
// snapshot); redundancy here costs one extra Dexie read, not a visible
// glitch — see widgets.ts's own refreshWidgets doc comment.
void refreshWidgets();

// Field-reports increment (increment 5, ported from Runway): retries
// whatever's still `status: 'pending'` in the fieldReports table against
// GitHub Issues, same fire-and-forget treatment as the calls above — never
// blocks the first render, never throws (see reportSync.ts's own doc
// comment), and picking up the queue on every app open is what makes
// offline capture eventually consistent without any background sync
// worker.
void syncPendingReports();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
