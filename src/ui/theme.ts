// Theme controller. The app's colours are CSS tokens (src/index.css) selected
// by the `data-theme` attribute on <html>. This module sets that attribute
// from the user's saved preference: 'light', 'dark', or 'system' (follow the
// OS, updating live when the OS setting changes).

import type { ThemePreference } from '../db/types';

const media = window.matchMedia('(prefers-color-scheme: dark)');

function resolve(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'system') return media.matches ? 'dark' : 'light';
  return pref;
}

function apply(pref: ThemePreference): void {
  document.documentElement.setAttribute('data-theme', resolve(pref));
}

let current: ThemePreference = 'system';
let listening = false;

// Set the active theme preference and apply it. When 'system', we also start
// listening for OS theme changes so the app follows them live.
export function setTheme(pref: ThemePreference): void {
  current = pref;
  apply(pref);

  if (pref === 'system' && !listening) {
    // Re-apply on OS change while in system mode.
    media.addEventListener('change', onSystemChange);
    listening = true;
  } else if (pref !== 'system' && listening) {
    media.removeEventListener('change', onSystemChange);
    listening = false;
  }
}

function onSystemChange(): void {
  if (current === 'system') apply('system');
}
