import { describe, it, expect } from 'vitest';
import { createPasscodeRecord, verifyPasscode } from './passcode';

// These tests exercise real create/verify at the full 210,000 iterations.
// That's slow-ish in principle but well within Node's PBKDF2 performance —
// no shortcut taken here, so a regression in the actual production path
// would actually fail these.

describe('passcode — create/verify round trip', () => {
  it('verifies the correct passcode against its own record', async () => {
    const record = await createPasscodeRecord('orchid-72');
    expect(await verifyPasscode('orchid-72', record)).toBe(true);
  });

  it('rejects an incorrect passcode', async () => {
    const record = await createPasscodeRecord('orchid-72');
    expect(await verifyPasscode('orchid-73', record)).toBe(false);
  });

  it('salts each record independently: same passcode, different salt and hash', async () => {
    const a = await createPasscodeRecord('orchid-72');
    const b = await createPasscodeRecord('orchid-72');
    expect(a.saltB64).not.toBe(b.saltB64);
    expect(a.hashB64).not.toBe(b.hashB64);
  });
});
