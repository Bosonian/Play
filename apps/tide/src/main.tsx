import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './db/db'; // import for side effect: opens the database before first render
import './index.css';
import { logEvent, pruneEventLog } from './lib/eventLog';
import { checkForUpdate } from './lib/updateCheck';
import { syncHealthData } from './lib/healthSync';

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
void syncHealthData();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
