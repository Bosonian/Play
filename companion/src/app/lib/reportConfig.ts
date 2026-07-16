// Configuration for filing field reports as GitHub issues. Mirrors
// passcode.ts's record pattern: a small, shape-validated localStorage
// record, JSON.parse in a try/catch, corrupt/wrong-shape treated as "not
// configured" rather than thrown.
//
// SPEC RISK D: the access token lives in localStorage in plaintext. That is
// UI-gated by the doctor passcode (DoctorGate sits in front of every screen
// that can read or write this record), NOT cryptographically protected —
// exactly the same threat model as passcode.ts's own record: anyone holding
// the unlocked device who opens devtools can read it. Acceptable for now,
// for the same reason passcode.ts gives: there is nothing higher-value
// behind doctor mode yet than what devtools already exposes on an unlocked
// phone.
//
// A second, sharper risk this file does NOT mitigate: this same
// ReportConfig — including the token — is reachable from PATIENT mode too
// (ReportProblem.tsx reads it for its warning copy, and submitReport/
// drainReports run from the patient screens). A repo-write PAT sitting on a
// *patient's* device is a documented later distribution concern: a stolen or
// unlocked patient phone yields a token that can write issues (and, via
// uploadContent, arbitrary file content) to the configured repo. That's
// acceptable while devices are study-controlled and provisioned by the
// study team, but it must be revisited (e.g. narrower token scope, a
// server-side relay, or per-device tokens) before any wider distribution.
export interface ReportConfig {
  version: 1;
  owner: string;
  repo: string;
  label: string;
  screenshotDir: string;
  token: string; // fine-grained PAT — never rendered back to the UI after entry
  repoIsPublic: boolean | null; // cached at configure time; null = unverified
  verifiedAt: string | null; // ISO
}

export const DEFAULT_LABEL = 'field-report';
export const DEFAULT_SCREENSHOT_DIR = 'field-reports';

const STORAGE_KEY = 'companion.reportConfig.v1';

// JSON.parse in a try/catch; anything that doesn't parse, or doesn't look
// like a ReportConfig, is treated as "not configured" rather than thrown —
// same tradeoff passcode.ts's loadPasscodeRecord makes, and for the same
// reason: there is no recovery flow either way, so failing soft into the
// setup screen is more useful than throwing.
export function loadReportConfig(): ReportConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as ReportConfig).version === 1 &&
      typeof (parsed as ReportConfig).owner === 'string' &&
      typeof (parsed as ReportConfig).repo === 'string' &&
      typeof (parsed as ReportConfig).label === 'string' &&
      typeof (parsed as ReportConfig).screenshotDir === 'string' &&
      typeof (parsed as ReportConfig).token === 'string' &&
      ((parsed as ReportConfig).repoIsPublic === null ||
        typeof (parsed as ReportConfig).repoIsPublic === 'boolean') &&
      ((parsed as ReportConfig).verifiedAt === null ||
        typeof (parsed as ReportConfig).verifiedAt === 'string')
    ) {
      return parsed as ReportConfig;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveReportConfig(config: ReportConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// Blanks the token only, keeping owner/repo/label/dir (and the cached
// visibility fields) intact — "Clear" in ReportSettings is aimed at revoking
// the credential, not re-doing the whole setup. No-op if nothing is stored
// yet (matches saveReportConfig's own no-guard-needed shape: there's nothing
// to corrupt by writing over absence).
export function clearReportToken(): void {
  const existing = loadReportConfig();
  if (!existing) return;
  saveReportConfig({ ...existing, token: '' });
}
