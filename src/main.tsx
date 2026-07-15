import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { getSettings } from './db/db';
import { setTheme } from './ui/theme';
import { runContentLintInDev } from './content';

// Bootstrap. Rendering must NOT depend on IndexedDB succeeding: if the DB open
// hangs or rejects (private mode, blocked upgrade, storage denied), we still
// mount the app so the user sees something (screens tolerate empty data) rather
// than a permanent blank screen (robustness audit P0).

const rootEl = document.getElementById('root');
if (!rootEl) {
  // Nothing we can do but say so.
  document.body.textContent = 'Head-in could not start (missing root element).';
} else {
  const root = createRoot(rootEl);

  const render = () =>
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
          <UpdatePrompt />
        </ErrorBoundary>
      </StrictMode>,
    );

  // Apply the saved theme, but never block first paint on it. A synchronous
  // inline script in index.html has already set data-theme from the OS
  // preference, so there's no flash; this just applies the saved override.
  getSettings()
    .then((settings) => setTheme(settings.theme))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[Head-in] settings unavailable; using defaults', err);
    })
    .finally(() => {
      runContentLintInDev();
      render();
    });
}
