import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { ensureSeeded } from './db/seeds';

// Fire-and-forget seed on every load. ensureSeeded() is idempotent — it
// only inserts if a table is empty, so steady-state cost is three count()
// queries (~ms). Not awaited so first paint isn't blocked; useLiveQuery
// hooks in components update as soon as data is available.
void ensureSeeded();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
