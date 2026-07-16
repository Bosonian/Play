// Alongside src/app/report/githubApi.ts, this is the only other network code
// in the app. It sends NO patient data — a single unauthenticated GET to a
// public GitHub release. It is fail-silent by design: any failure (offline,
// malformed JSON, unexpected shape, a thrown network error) resolves to
// `null` rather than throwing, so a flaky connection or a GitHub outage can
// never surface an error to the patient — it just means no update banner
// shows this session.
export interface UpdateInfo {
  version: string;
  buildNumber: number;
  apkUrl: string;
}

export const RELEASE_API_URL =
  'https://api.github.com/repos/Bosonian/Play/releases/tags/companion-latest';

// Used when the release JSON's assets array doesn't contain companion.apk
// (e.g. an in-progress publish, or an unexpected rename) — this URL still
// resolves via GitHub's "latest asset with this name on this tag" redirect.
export const APK_FALLBACK_URL =
  'https://github.com/Bosonian/Play/releases/download/companion-latest/companion.apk';

export async function checkForUpdate(
  currentBuild: number,
  fetchFn: typeof fetch = fetch,
): Promise<UpdateInfo | null> {
  try {
    const res = await fetchFn(RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return null;

    const json = await res.json();
    const body = String(json.body ?? '');

    // The release body's exact text is "Version <semver> (build <N>)." —
    // written by the CI publish step. The build number is the load-bearing
    // half of that match (it's what versionCode comparison hinges on); the
    // version string is decorative and degrades gracefully to '' below.
    const buildMatch = body.match(/build\s+(\d+)/i);
    if (!buildMatch) return null;
    const buildNumber = Number(buildMatch[1]);

    const versionMatch = body.match(/Version\s+([\d.]+)/i);
    const version = versionMatch ? versionMatch[1] : '';

    const asset = Array.isArray(json.assets)
      ? json.assets.find((a: { name?: string }) => a?.name === 'companion.apk')
      : undefined;
    const apkUrl = asset?.browser_download_url ?? APK_FALLBACK_URL;

    if (Number.isFinite(buildNumber) && buildNumber > currentBuild) {
      return { version, buildNumber, apkUrl };
    }
    return null;
  } catch {
    return null;
  }
}
