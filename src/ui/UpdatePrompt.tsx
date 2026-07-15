// New-version prompt. With registerType:'prompt' (vite.config.ts) a new deploy
// is precached but NOT auto-applied — so it can never hard-reload the user out
// of the middle of a round (robustness audit P0). Instead we show a small,
// dismissible bar; the user updates when they choose to.

import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md p-3 pb-safe-bottom">
      <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3 shadow-lg">
        <span className="text-body text-fg">A new version is ready.</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNeedRefresh(false)}
            className="text-label text-fg-muted"
          >
            Later
          </button>
          <button
            type="button"
            onClick={() => void updateServiceWorker(true)}
            className="rounded-sm bg-accent px-3 py-1.5 text-label font-medium text-white"
          >
            Update
          </button>
        </div>
      </div>
    </div>
  );
}
