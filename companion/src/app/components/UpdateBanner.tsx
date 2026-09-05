import { useEffect, useState } from 'react';
import { checkForUpdate, type UpdateInfo } from '../lib/updates';
import { getAndroidAppIdentity } from '../lib/appUpdateIdentity';

// Mounted once at the app root (see App.tsx) so the update check runs
// exactly once per app open, in both patient and doctor mode. Dismissal is
// session-only — there is no persistence, so a genuinely new build
// re-appears next open. That's the correct behaviour: this isn't a
// notification the patient needs to permanently silence, just a quiet nudge
// that's cheap to re-show.
export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Fire-and-forget, guarded against setting state after unmount.
    // checkForUpdate never throws (see updates.ts) — offline or a malformed
    // response both resolve to null, so there's nothing to catch here.
    let cancelled = false;
    void getAndroidAppIdentity().then((identity) =>
      identity ? checkForUpdate(identity) : null,
    ).then((update) => {
      if (!cancelled) setInfo(update);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info || dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-surface-soft px-4 py-3">
      <div>
        <p className="text-label text-fg">Update available</p>
        <p className="text-caption text-fg-muted">Version {info.versionName}</p>
      </div>
      <div className="flex items-center gap-4">
        {/* An anchor with target="_blank", not window.open — this is what hands
            the APK to the system browser from a Capacitor WebView, and Android
            takes it from there (install prompt). No auto-download, no
            auto-install. */}
        <a
          href={info.apkUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-accent px-4 py-2 text-label text-white"
        >
          Download
        </a>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-label text-fg-muted underline underline-offset-2"
        >
          Later
        </button>
      </div>
    </div>
  );
}
