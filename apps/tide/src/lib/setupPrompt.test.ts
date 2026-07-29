import { describe, expect, it } from 'vitest';
import { shouldShowSetupPrompt } from './setupPrompt';

describe('shouldShowSetupPrompt', () => {
  it('shows when Health Connect is missing and nothing else is', () => {
    expect(shouldShowSetupPrompt({ healthConnectMissing: true, dailyShapeMissing: false }, false)).toBe(true);
  });

  it('shows when only the daily-shape target is missing', () => {
    expect(shouldShowSetupPrompt({ healthConnectMissing: false, dailyShapeMissing: true }, false)).toBe(true);
  });

  it('shows when both steps are missing', () => {
    expect(shouldShowSetupPrompt({ healthConnectMissing: true, dailyShapeMissing: true }, false)).toBe(true);
  });

  it('renders nothing once both steps are done', () => {
    expect(shouldShowSetupPrompt({ healthConnectMissing: false, dailyShapeMissing: false }, false)).toBe(false);
  });

  it('stays hidden once dismissed, even with both steps still missing', () => {
    expect(shouldShowSetupPrompt({ healthConnectMissing: true, dailyShapeMissing: true }, true)).toBe(false);
  });
});
