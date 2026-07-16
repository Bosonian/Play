// The ONLY file in this app that calls fetch. This is the first-ever network
// code the companion ships — every file above this one in the report
// pipeline (github.ts's payload builders, queue.ts's engine) is unit-tested
// against a hand-rolled GithubApi fake or a stubbed fetchFn, never against a
// real network call. The real GitHub round trip (does a token with the right
// scopes actually create an issue, does CORS actually behave as expected)
// is verifiable on-device only — see §8 of the spec, "NOT unit-tested by
// design". CORS `*` on api.github.com is what makes this callable at all
// from a capacitor://localhost WebView origin; that's a GitHub platform
// behavior, not something this file configures.
import type { IssuePayload } from './github';

export interface RepoTarget {
  owner: string;
  repo: string;
  token: string;
}

export interface GithubApi {
  createIssue(target: RepoTarget, payload: IssuePayload): Promise<{ htmlUrl: string }>;
  uploadContent(
    target: RepoTarget,
    path: string,
    base64Content: string,
    message: string,
  ): Promise<{ htmlUrl: string }>;
  getRepoIsPublic(target: RepoTarget): Promise<boolean>;
}

const API_VERSION = '2022-11-28';

function baseHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  };
}

// Non-2xx responses throw a message built from the status and the request
// shape only — NEVER the token, and never response body text either (a
// GitHub error body could itself echo back request contents). `path` here is
// the API path (e.g. "/repos/o/r/issues"), not a filesystem path.
async function checkOk(response: Response, method: string, path: string): Promise<void> {
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} on ${method} ${path}`);
  }
}

export function makeGithubApi(fetchFn: typeof fetch = fetch): GithubApi {
  return {
    async createIssue(target, payload) {
      const path = `/repos/${target.owner}/${target.repo}/issues`;
      const response = await fetchFn(`https://api.github.com${path}`, {
        method: 'POST',
        headers: { ...baseHeaders(target.token), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await checkOk(response, 'POST', path);
      const json = (await response.json()) as { html_url: string };
      return { htmlUrl: json.html_url };
    },

    async uploadContent(target, contentPath, base64Content, message) {
      const path = `/repos/${target.owner}/${target.repo}/contents/${contentPath}`;
      const response = await fetchFn(`https://api.github.com${path}`, {
        method: 'PUT',
        headers: { ...baseHeaders(target.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: base64Content }),
      });
      await checkOk(response, 'PUT', path);
      const json = (await response.json()) as { content: { html_url: string } };
      return { htmlUrl: json.content.html_url };
    },

    async getRepoIsPublic(target) {
      const path = `/repos/${target.owner}/${target.repo}`;
      const response = await fetchFn(`https://api.github.com${path}`, {
        method: 'GET',
        headers: baseHeaders(target.token),
      });
      await checkOk(response, 'GET', path);
      const json = (await response.json()) as { private: boolean };
      return !json.private;
    },
  };
}
