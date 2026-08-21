import { describe, expect, it } from 'vitest';
import { truncateErrorMessage } from './ErrorBoundary';

// The boundary's own catch/render behaviour has no test here — this app has
// no jsdom/React Testing Library precedent (a grep of the existing test
// suite turned up none: every test either exercises a pure function against
// plain data, or mocks Dexie directly, never a rendered component), and
// standing one up for a single class component is heavier than this fix
// earns. `truncateErrorMessage` is the one piece of real, pure logic inside
// ErrorBoundary.tsx, so it's what's covered directly instead — see that
// file's own doc comment on the function for the same reasoning.
describe('truncateErrorMessage', () => {
  it('returns the message unchanged when at or under the limit', () => {
    expect(truncateErrorMessage('short message')).toBe('short message');
    expect(truncateErrorMessage('x'.repeat(120))).toBe('x'.repeat(120));
  });

  it('truncates and appends an ellipsis marker past the limit', () => {
    const long = 'y'.repeat(150);
    const result = truncateErrorMessage(long);
    expect(result).toBe(`${'y'.repeat(120)}…`);
    expect(result.length).toBe(121); // 120 kept chars + 1 ellipsis char
  });

  it('respects a custom maxChars', () => {
    expect(truncateErrorMessage('abcdefgh', 4)).toBe('abcd…');
  });

  it('handles an empty message', () => {
    expect(truncateErrorMessage('')).toBe('');
  });

  it('boundary case: exactly maxChars long stays untouched', () => {
    const exact = 'z'.repeat(120);
    expect(truncateErrorMessage(exact)).toBe(exact);
  });

  it('boundary case: one char past maxChars gets truncated', () => {
    const overByOne = 'z'.repeat(121);
    expect(truncateErrorMessage(overByOne)).toBe(`${'z'.repeat(120)}…`);
  });
});
