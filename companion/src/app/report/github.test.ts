import { describe, it, expect } from 'vitest';
import { buildIssueTitle, buildIssueBody, buildIssuePayload, buildScreenshotPath } from './github';
import type { FieldReport } from './types';

function baseReport(overrides: Partial<FieldReport> = {}): FieldReport {
  return {
    id: 'f1234567-89ab-cdef-0123-456789abcdef',
    createdAt: '2026-07-16T08:00:00.000Z',
    status: 'pending',
    description: 'The dose timer shows the wrong slot after midnight.',
    metadata: { appVersion: '0.9.1', screen: 'patient-home', at: '2026-07-16T08:00:00.000Z' },
    ...overrides,
  };
}

describe('buildIssueTitle', () => {
  it('prefixes a plain single-line description with "Field report: "', () => {
    expect(buildIssueTitle('Dose timer is wrong')).toBe('Field report: Dose timer is wrong');
  });

  it('uses only the first line of a multiline description', () => {
    const description = 'First line here\nSecond line, ignored\nThird line, also ignored';
    expect(buildIssueTitle(description)).toBe('Field report: First line here');
  });

  it('truncates a first line longer than 72 characters', () => {
    const longLine = 'x'.repeat(100);
    const title = buildIssueTitle(longLine);
    // "Field report: " (14 chars) + 72 clipped chars + the ellipsis marker.
    expect(title).toBe(`Field report: ${'x'.repeat(72)}…`);
  });
});

describe('buildIssueBody', () => {
  it('without attachedLog: has exactly 3 metadata table rows and no triple-backtick fence', () => {
    const report = baseReport();
    const body = buildIssueBody(report);
    expect(body).not.toContain('```');
    expect(body).toContain('| App version | 0.9.1 |');
    expect(body).toContain('| Screen | patient-home |');
    expect(body).toContain('| Filed at | 2026-07-16T08:00:00.000Z |');
  });

  it('with attachedLog: body ends with the closing fence and contains the log lines', () => {
    const attachedLog = '2026-07-16T07:00:00.000Z [dose] Logged dose: Levodopa 100 mg, 08:00 slot';
    const report = baseReport({ attachedLog });
    const body = buildIssueBody(report);
    expect(body.endsWith('```')).toBe(true);
    expect(body).toContain(attachedLog);
    expect(body).toContain('Activity log (last 50 lines):');
  });

  it('includes a markdown LINK (not an image) when screenshotUrl is given', () => {
    const report = baseReport();
    const body = buildIssueBody(report, 'https://github.com/o/r/blob/main/field-reports/f1.png');
    expect(body).toContain('[Screenshot](https://github.com/o/r/blob/main/field-reports/f1.png)');
    expect(body).not.toContain('![Screenshot]');
  });

  it('omits the screenshot line entirely when no screenshotUrl is given', () => {
    const report = baseReport();
    const body = buildIssueBody(report);
    expect(body).not.toContain('[Screenshot]');
  });

  it('orders sections: description first, metadata table before the log fence', () => {
    const attachedLog = 'line one';
    const report = baseReport({ attachedLog });
    const body = buildIssueBody(report, 'https://example.com/shot.png');
    const descIndex = body.indexOf(report.description);
    const tableIndex = body.indexOf('| Field | Value |');
    const screenshotIndex = body.indexOf('[Screenshot]');
    const fenceIndex = body.indexOf('```');
    expect(descIndex).toBe(0);
    expect(tableIndex).toBeGreaterThan(descIndex);
    expect(screenshotIndex).toBeGreaterThan(tableIndex);
    expect(fenceIndex).toBeGreaterThan(screenshotIndex);
  });
});

describe('buildIssuePayload', () => {
  it('sets labels to exactly [label] and reuses the title/body builders', () => {
    const report = baseReport();
    const payload = buildIssuePayload(report, 'field-report');
    expect(payload.labels).toEqual(['field-report']);
    expect(payload.title).toBe(buildIssueTitle(report.description));
    expect(payload.body).toBe(buildIssueBody(report, undefined));
  });
});

describe('buildScreenshotPath', () => {
  it('maps known mime types to their extension', () => {
    expect(buildScreenshotPath(baseReport({ id: 'abc', screenshotType: 'image/png' }), 'field-reports')).toBe(
      'field-reports/abc.png',
    );
    expect(buildScreenshotPath(baseReport({ id: 'abc', screenshotType: 'image/jpeg' }), 'field-reports')).toBe(
      'field-reports/abc.jpg',
    );
    expect(buildScreenshotPath(baseReport({ id: 'abc', screenshotType: 'image/webp' }), 'field-reports')).toBe(
      'field-reports/abc.webp',
    );
  });

  it('falls back to png for an unknown or missing mime type', () => {
    expect(buildScreenshotPath(baseReport({ id: 'abc', screenshotType: 'image/gif' }), 'field-reports')).toBe(
      'field-reports/abc.png',
    );
    expect(buildScreenshotPath(baseReport({ id: 'abc', screenshotType: undefined }), 'field-reports')).toBe(
      'field-reports/abc.png',
    );
  });
});
