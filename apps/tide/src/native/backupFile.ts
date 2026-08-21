import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// Ported from apps/runway/src/native/backupFile.ts, which is the mechanism
// already proven on this exact device. This file is the ONE choke point for
// both plugins it imports — same "only file that imports X" pattern as
// native/healthConnect.ts.
//
// WHY THESE TWO PLUGINS WERE ADDED (the increment's own brief started out
// forbidding new dependencies, and this is the one place that rule had to
// give): a Capacitor Android WebView does not turn a `blob:` URL +
// `<a download>` click into a real file the way a desktop browser tab does —
// it needs either a registered DownloadListener or a native plugin. Shipping
// the blob path on native would have produced an "Export backup" button that
// silently did nothing, which is worse than having no button at all for a
// feature whose entire purpose is getting the data OFF the phone. Adding
// @capacitor/filesystem + @capacitor/share is exactly the parity Runway
// already has, at versions this monorepo already builds against, so the
// native-build risk is low and previously travelled.

/**
 * Writes `json` to a file named `filename` and hands it to the OS share
 * sheet (native) or triggers a browser download (web).
 *
 * Native path: `Directory.Cache`, not `Directory.Data` — a backup exported
 * once and then saved elsewhere has no reason to persist inside the app's own
 * storage afterwards; Android is free to reclaim cache space under pressure,
 * which is the correct lifetime for a file whose only job was to exist long
 * enough for the share sheet to read it. `Share.share` offers whatever the
 * phone's installed apps register for a JSON file — Drive, Gmail, My Files —
 * Tide doesn't pick among them.
 *
 * Web fallback: a plain `Blob` + anchor-click download, for `npm run dev` in a
 * real browser on the Mac. There is no share sheet in a browser tab, so
 * "download the file" is the closest equivalent and a genuinely useful path
 * of its own.
 *
 * Throws are left to the caller (Settings' export handler shows the failure)
 * rather than swallowed here: unlike a read that can honestly resolve
 * "nothing", an export that failed must NOT look like one that succeeded —
 * a backup silently not happening is the single worst outcome for this
 * feature.
 */
export async function exportBackupFile(json: string, filename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({
      path: filename,
      data: json,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({
      title: 'Tide backup',
      dialogTitle: 'Save or send this backup',
      files: [written.uri],
    });
    return;
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
