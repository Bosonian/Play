import { db } from '../db/db';

// Ported from apps/runway/src/lib/reportSettings.ts verbatim in spirit —
// settings-table keys for the field-reports increment, same "two rows in
// the existing key-value `settings` table" treatment every other Tide
// setting already gets (healthSettings.ts's Health Connect flags, etc.).
export const FEEDBACK_TOKEN_SETTING = 'feedbackToken';
export const FEEDBACK_REPO_SETTING = 'feedbackRepo';

/** The repo a report is filed to when the setting is unset or blank —
 * Deepak's own Play repo (the same monorepo Tide itself lives in), not a
 * dedicated feedback repo, so field reports work with zero setup beyond
 * generating a token. Settings.tsx shows this as the field's placeholder so
 * the default is visible even before it's ever been typed. */
export const DEFAULT_FEEDBACK_REPO = 'Bosonian/Play';

// "owner/name" — GitHub's own username and repo-name character set (no
// spaces, no slashes beyond the one separator). Deliberately permissive
// about which characters count as valid *within* each half (GitHub allows
// hyphens, underscores, dots) rather than exhaustively matching every one
// of GitHub's actual naming rules — the goal here is catching obviously
// malformed input (a stray URL pasted in, an empty half), not fully
// validating a name GitHub itself will reject anyway on the API call if
// it's wrong in some subtler way.
const REPO_SHAPE = /^[\w.-]+\/[\w.-]+$/;

export interface ReportConfig {
  token: string;
  repo: string;
}

/**
 * Single source of truth for "what to sync field reports against" —
 * reportSync.ts is the only reader. A report config has no "enabled" gate
 * of its own: a present, well-shaped token IS the enable switch
 * (reportSync's step 1 — no token, return silently).
 */
export async function readReportConfig(): Promise<ReportConfig> {
  const [tokenRow, repoRow] = await Promise.all([
    db.settings.get(FEEDBACK_TOKEN_SETTING),
    db.settings.get(FEEDBACK_REPO_SETTING),
  ]);
  const token = tokenRow?.value ?? '';
  const repoValue = repoRow?.value?.trim() ?? '';
  const repo = REPO_SHAPE.test(repoValue) ? repoValue : DEFAULT_FEEDBACK_REPO;
  return { token, repo };
}
