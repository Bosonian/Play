import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// New plugins this increment: @capacitor/filesystem (write the backup JSON
// somewhere the OS share sheet can read it from) and @capacitor/share (hand
// that file to Drive/Gmail/My File/whatever Deepak picks). Neither plugin is
// used anywhere else in this app — this file is their one choke point, same
// "only file that imports X" pattern as notifications.ts/dayGauge.ts.

/**
 * Writes `json` to a file named `filename` and hands it to the OS share
 * sheet (native) or triggers a browser download (web).
 *
 * Native path: `Directory.Cache`, not `Directory.Data` — a backup file
 * exported once and then shared/saved elsewhere has no reason to persist
 * inside the app's own storage afterwards; Android is free to reclaim cache
 * space under pressure, which is the correct lifetime for a file whose only
 * job was to exist long enough for the share sheet to read it. `Share.share`
 * offers whatever the phone's installed apps register for JSON/generic
 * files — Drive, Gmail, My Files — Runway doesn't pick among them.
 *
 * Web fallback: a plain `Blob` + anchor-click download. This exists for the
 * Mac/dev usage CLAUDE.md names (`npm run dev` in a real browser) — there is
 * no native share sheet in a browser tab, so "download the file" is the
 * closest equivalent, and it's a real, useful path in its own right (a
 * backup saved straight into the Mac's Downloads folder).
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
      title: 'Runway backup',
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
