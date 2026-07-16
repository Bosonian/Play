// Pure builders for the GitHub issue payload a field report becomes. No
// fetch, no Dexie, no React — the only thing that touches the network is
// githubApi.ts, which consumes what this file builds. Keeping the two apart
// means every shape/format decision here is unit-testable without a fake
// fetch or a live GitHub round trip.
import type { FieldReport } from './types';

export interface IssuePayload {
  title: string;
  body: string;
  labels: string[];
}

const TITLE_MAX = 72;

// "Field report: <first line>", first line truncated to 72 chars. The
// description is free text from a dictation-heavy input (Wispr Flow, per
// CLAUDE.md) — it can be many paragraphs, or a single very long line, so the
// title takes only the first line and clips it rather than risking a
// multi-KB issue title.
export function buildIssueTitle(description: string): string {
  const firstLine = description.split('\n')[0] ?? '';
  const clipped = firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX)}…` : firstLine;
  return `Field report: ${clipped}`;
}

// Layout, joined by blank lines, in order:
//   1. description verbatim
//   2. metadata table
//   3. (only if screenshotUrl) a markdown LINK, not an inline image —
//      private-repo raw URLs need an Authorization header an <img> tag can't
//      send, so a bare ![]() would render as a broken image for anyone
//      without the token already in their browser session.
//   4. (only if report.attachedLog) the fenced activity-log block. When
//      present, the body ENDS with the closing fence — nothing is appended
//      after it. Activity-log messages are built from fixed sentence
//      templates with no free-text interpolation of backticks (see
//      activityLog.ts's module header: exact sentences), so the fence can't
//      be broken out of by log content.
export function buildIssueBody(report: FieldReport, screenshotUrl?: string): string {
  const sections: string[] = [report.description];

  const table = [
    '| Field | Value |',
    '| --- | --- |',
    `| App version | ${report.metadata.appVersion} |`,
    `| Screen | ${report.metadata.screen} |`,
    `| Filed at | ${report.metadata.at} |`,
  ].join('\n');
  sections.push(table);

  if (screenshotUrl) {
    sections.push(`[Screenshot](${screenshotUrl})`);
  }

  if (report.attachedLog) {
    sections.push(`Activity log (last 50 lines):\n\`\`\`\n${report.attachedLog}\n\`\`\``);
  }

  return sections.join('\n\n');
}

export function buildIssuePayload(
  report: FieldReport,
  label: string,
  screenshotUrl?: string,
): IssuePayload {
  return {
    title: buildIssueTitle(report.description),
    body: buildIssueBody(report, screenshotUrl),
    labels: [label],
  };
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// "<dir>/<id>.<ext>" — the repo-relative path a screenshot is uploaded to.
// Unknown/missing mime types fall back to png rather than throwing: the file
// picker in ReportProblem.tsx already constrains `accept="image/*"`, so an
// unrecognized type here would be a browser quirk, not a bad report — a
// wrong-but-harmless extension beats blocking the upload outright.
export function buildScreenshotPath(report: FieldReport, screenshotDir: string): string {
  const ext = (report.screenshotType && EXT_BY_MIME[report.screenshotType]) || 'png';
  return `${screenshotDir}/${report.id}.${ext}`;
}
