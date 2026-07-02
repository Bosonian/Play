import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { getSettings } from './db/db';
import { setTheme } from './ui/theme';
import { runContentLintInDev } from './content';

// Bootstrap. Apply the saved theme before first paint so there's no flash of
// the wrong theme, then render. getSettings() creates the settings row with
// defaults on first run.
async function boot() {
  const settings = await getSettings();
  setTheme(settings.theme);

  // Dev-only: validate content shape + cross-references, log any issues.
  runContentLintInDev();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
