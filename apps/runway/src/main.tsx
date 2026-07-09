import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './db/db'; // import for side effect: registers the populate hook before first open
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
