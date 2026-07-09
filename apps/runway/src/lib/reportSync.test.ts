import { describe, expect, it } from 'vitest';
import { buildIssuePayload, classifySyncError } from './reportSync';
import type { FieldReport } from '../db/types';

function makeReport(overrides: Partial<FieldReport> = {}): FieldReport {
  return {
    id: 'abcdef12-3456-7890-abcd-ef1234567890',
    createdAt: '2026-07-09T08:15:00.000Z',
    description: 'The countdown froze after re-anchoring.',
    screenName: 'runway',
    appVersion: '0.15.0',
    screenshotBase64: null,
    screenshotMime: null,
    status: 'pending',
    syncedIssueUrl: null,
    syncError: null,
    ...overrides,
  };
}

describe('buildIssuePayload', () => {
  it('uses the full description as the title when it is at or under 60 characters', () => {
    const report = makeReport({ description: 'Short description under sixty chars.' });
    const { title } = buildIssuePayload(report);
    expect(title).toBe('Short description under sixty chars.');
    expect(title.endsWith('…')).toBe(false);
  });

  it('does not truncate a description of exactly 60 characters', () => {
    const description = 'a'.repeat(60);
    const { title } = buildIssuePayload(makeReport({ description }));
    expect(title).toBe(description);
    expect(title).toHaveLength(60);
  });

  it('truncates to 60 characters plus an ellipsis for a longer description', () => {
    const description = 'b'.repeat(75);
    const { title } = buildIssuePayload(makeReport({ description }));
    expect(title).toBe(`${'b'.repeat(60)}…`);
    expect(title).toHaveLength(61);
  });

  it('includes app version, screen, and createdAt in the context block', () => {
    const report = makeReport({ appVersion: '0.15.0', screenName: 'home', createdAt: '2026-07-09T08:15:00.000Z' });
    const { body } = buildIssuePayload(report);
    expect(body).toContain('App version: 0.15.0');
    expect(body).toContain('Screen: home');
    expect(body).toContain('Reported: 2026-07-09T08:15:00.000Z');
    expect(body).toContain("Filed from Runway's in-app reporter.");
  });

  it('starts the context block with the description followed by a --- separator', () => {
    const report = makeReport({ description: 'Buttons overlap on small screens.' });
    const { body } = buildIssuePayload(report);
    expect(body.startsWith('Buttons overlap on small screens.\n\n---\n')).toBe(true);
  });

  it('omits the screenshot markdown image when no screenshot URL is given', () => {
    const { body } = buildIssuePayload(makeReport());
    expect(body).not.toContain('![screenshot]');
  });

  it('appends the screenshot markdown image when a screenshot URL is given', () => {
    const url = 'https://raw.githubusercontent.com/Bosonian/Play/main/field-reports/2026-07-09-abcdef12.jpg';
    const { body } = buildIssuePayload(makeReport(), url);
    expect(body).toContain(`![screenshot](${url})`);
  });

  it('omits the screenshot markdown image when the screenshot URL is null', () => {
    const { body } = buildIssuePayload(makeReport(), null);
    expect(body).not.toContain('![screenshot]');
  });
});

describe('classifySyncError', () => {
  it.each([401, 403, 404, 422])('classifies status %i as failed (permanent)', (status) => {
    expect(classifySyncError(status)).toBe('failed');
  });

  it.each([0, 409, 500, 502, 503])('classifies status %i as pending (retryable)', (status) => {
    expect(classifySyncError(status)).toBe('pending');
  });

  it('classifies a null status (network error or timeout) as pending', () => {
    expect(classifySyncError(null)).toBe('pending');
  });
});
