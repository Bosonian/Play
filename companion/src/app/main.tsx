import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

// Bootstrap. This increment has no local database and no persisted theme
// override (see index.css) — there's nothing to await before first paint,
// so unlike the root Head-in app's main.tsx this renders synchronously.

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
}
