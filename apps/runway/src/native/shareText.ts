import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

// The ONLY file that shares plain text — separate from backupFile.ts, which
// shares a FILE (@capacitor/filesystem + @capacitor/share together). This
// file needs no filesystem write at all: a witness message is short-lived
// text handed straight to the OS share sheet, never saved anywhere.

/**
 * 'shared': the text left this device via a share target or clipboard.
 * 'dismissed': the user opened the share sheet and backed out of it — a
 * decision, not an error (see below).
 * 'unavailable': no share mechanism exists here at all (rare — only a
 * desktop browser without `navigator.share` support falls through to the
 * clipboard path instead, so this mainly covers Share.share throwing
 * something that isn't the dismissal message).
 */
export type ShareResult = 'shared' | 'dismissed' | 'unavailable';

/**
 * Hands `text` to the OS share sheet (native) or the closest web equivalent.
 * Never throws — every path resolves to one of the three ShareResult values
 * above, so callers never need a try/catch of their own.
 */
export async function shareWitnessText(text: string): Promise<ShareResult> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ text });
      return 'shared';
    } catch (err) {
      // Same lesson as backupFile.ts's 0.32.0 review fix (see Settings.tsx's
      // handleExportBackup): on Android, @capacitor/share REJECTS when the
      // share sheet is dismissed without picking a target ("Share
      // canceled") — that's Deepak deciding not to send it, not a failure
      // of the share mechanism, so it reads as 'dismissed' rather than
      // 'unavailable'.
      const message = err instanceof Error ? err.message : String(err);
      return /cancel/i.test(message) ? 'dismissed' : 'unavailable';
    }
  }

  // Web: prefer the real Web Share API when the browser offers it (mobile
  // Chrome, some desktop browsers) — same shared-target behaviour as
  // native, including a dismissal rejecting the promise.
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Chrome's web implementation rejects a dismissed sheet with an
      // AbortError, whose message doesn't always contain the word "cancel"
      // — checking the error's `name` too catches that case without
      // weakening the native branch's message-based check above.
      const name = err instanceof Error ? err.name : '';
      return /cancel/i.test(message) || name === 'AbortError' ? 'dismissed' : 'unavailable';
    }
  }

  // Desktop web with no Web Share API (most of the Mac/dev usage this app
  // names in CLAUDE.md): copy to the clipboard instead. This is the one
  // place 'shared' is a small lie — on desktop it really means "copied,
  // paste it yourself" — so the caller's confirmation copy has to stay
  // neutral enough to cover both meanings rather than claiming a message
  // was actually sent anywhere.
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return 'shared';
    } catch {
      return 'unavailable';
    }
  }

  return 'unavailable';
}
