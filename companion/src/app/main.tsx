import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { db } from './db/store';
import { runAppOpen } from './activity/activityLog';
import { drainReports } from './report/queue';

// Bootstrap. This increment has no persisted theme override (see index.css)
// — there's nothing to await before first paint, so unlike the root Head-in
// app's main.tsx this renders synchronously.

const rootEl = document.getElementById('root');
if (!rootEl) {
  // Nothing we can do but say so.
  document.body.textContent = 'Companion could not start (missing root element).';
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // Fire-and-forget, outside React: runAppOpen writes its own db row and
  // never throws (see activityLog.ts's contract), so there's nothing here
  // to await or catch. Deliberately outside the React tree so StrictMode's
  // double-invoke of effects/renders isn't in play — the module-scoped
  // appOpenRan guard in activityLog.ts is what dedupes repeat calls anyway.
  runAppOpen(db);
  // Also fire-and-forget, outside React, and also never throws (see
  // drainReports' own contract in queue.ts) — drains any reports that were
  // queued before this open (e.g. filed while offline) as soon as a network
  // path might exist, without blocking first paint on it.
  drainReports(db);
}
