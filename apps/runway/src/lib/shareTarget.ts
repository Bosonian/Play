/**
 * Extracts a destination name from raw shared text — Android's share-sheet
 * EXTRA_TEXT, rewritten by MainActivity.rewriteShareTargetIntent into the
 * `text` query param of a `runway://share-target?text=...` deep link (see
 * that Java method's own doc comment for the full mechanism). Google Maps'
 * "Share" action on a place formats EXTRA_TEXT as the place's name on one
 * line, followed by a maps.app.goo.gl (or full Maps) link on another —
 * "Klinikum Stuttgart\nhttps://maps.app.goo.gl/xyz" — but this function is
 * defensive about the shape rather than assuming Maps' exact format:
 * whatever text arrives, strip every http(s) URL out of it entirely (not
 * just a URL that happens to be on its own line — a link embedded mid-line
 * shouldn't leak into the destination either), then take the first
 * non-empty line once trimmed and whitespace-collapsed.
 *
 * Pure and never throws. An unparseable or entirely-URL input returns ''
 * (never null/undefined) — deepLinks.ts's caller treats an empty result as
 * "route to a plain, unprefilled departureSetup" rather than as an error to
 * surface, since a share with nothing usable in it isn't a broken share, it
 * just has nothing to offer.
 */
export function parseSharedDestination(text: string): string {
  const withoutUrls = text.replace(/https?:\/\/\S+/gi, '');
  const lines = withoutUrls.split(/\r?\n/);

  for (const line of lines) {
    // Whitespace-collapse mirrors the same defensive posture CLAUDE.md
    // calls for around Wispr Flow dictation artifacts (extra spaces,
    // stray tabs) — applied here to whatever the SHARING app formatted the
    // text with, not to Deepak's own typing, but the shape of the problem
    // (irregular internal whitespace that shouldn't survive into a clean
    // destination string) is the same.
    const collapsed = line.trim().replace(/\s+/g, ' ');
    if (collapsed !== '') return collapsed;
  }
  return '';
}
