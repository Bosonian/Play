import { useRef, useState } from 'react';
import {
  createPasscodeRecord,
  loadPasscodeRecord,
  savePasscodeRecord,
  verifyPasscode,
  MIN_PASSCODE_LENGTH,
  type PasscodeRecord,
} from '../lib/passcode';

interface DoctorGateProps {
  onUnlock: () => void;
  onBack: () => void;
}

// Gate in front of doctor mode. Reads the stored passcode record once on
// mount: if none exists yet, this is the first time doctor mode has been
// opened on this device and we walk through setting one; if one exists, we
// ask for it. There is no third state — a corrupted record is treated the
// same as "none exists" (see the comment in passcode.ts).
export function DoctorGate({ onUnlock, onBack }: DoctorGateProps) {
  const [record] = useState<PasscodeRecord | null>(() => loadPasscodeRecord());
  const cryptoAvailable = typeof crypto !== 'undefined' && !!crypto.subtle;

  const [passcode, setPasscode] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passcodeRef = useRef<HTMLInputElement>(null);
  const repeatRef = useRef<HTMLInputElement>(null);

  if (!cryptoAvailable) {
    return (
      <div className="rounded-md border border-line bg-surface p-4">
        <p className="text-body text-fg">The passcode system is not available in this browser.</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-4 text-label text-fg-muted underline underline-offset-2"
        >
          Back to patient mode
        </button>
      </div>
    );
  }

  async function handleSetSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    // Captured before we clear the state fields below — the plaintext
    // passcode never needs to outlive this handler.
    const enteredPasscode = passcode;
    const enteredRepeat = repeat;

    if (enteredPasscode.length < MIN_PASSCODE_LENGTH) {
      setError('Use at least 6 characters.');
      setPasscode('');
      setRepeat('');
      passcodeRef.current?.focus();
      return;
    }
    if (enteredPasscode !== enteredRepeat) {
      setError('The two entries do not match.');
      setPasscode('');
      setRepeat('');
      passcodeRef.current?.focus();
      return;
    }

    setError(null);
    setBusy(true);
    setPasscode('');
    setRepeat('');
    try {
      const newRecord = await createPasscodeRecord(enteredPasscode);
      savePasscodeRecord(newRecord);
      // No re-entry required — setting a passcode unlocks immediately.
      onUnlock();
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !record) return;

    const entered = passcode;
    setError(null);
    setBusy(true);
    setPasscode('');
    try {
      const ok = await verifyPasscode(entered, record);
      if (ok) {
        onUnlock();
      } else {
        // Unlimited retries — no lockout in this increment.
        setError('That passcode is not correct.');
        passcodeRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  }

  if (record === null) {
    return (
      <div className="rounded-md border border-line bg-surface p-4">
        <h1 className="text-title font-medium">Set a doctor passcode</h1>
        <p className="mt-2 text-body text-fg-muted">
          Doctor mode is protected by a passcode stored only on this device. There is no recovery
          if it is forgotten.
        </p>
        <form onSubmit={handleSetSubmit} className="mt-4 space-y-3">
          <div>
            <label htmlFor="doctor-passcode" className="block text-label text-fg-muted">
              Passcode
            </label>
            <input
              ref={passcodeRef}
              id="doctor-passcode"
              type="password"
              autoComplete="off"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="mt-1 w-full rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
            />
          </div>
          <div>
            <label htmlFor="doctor-passcode-repeat" className="block text-label text-fg-muted">
              Repeat passcode
            </label>
            <input
              ref={repeatRef}
              id="doctor-passcode-repeat"
              type="password"
              autoComplete="off"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              className="mt-1 w-full rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
            />
          </div>
          {error && <p className="text-label text-warn">{error}</p>}
          <div className="flex items-center gap-4 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-accent px-4 py-2 text-label text-white disabled:opacity-60"
            >
              Set passcode
            </button>
            <button
              type="button"
              onClick={onBack}
              className="text-label text-fg-muted underline underline-offset-2"
            >
              Back to patient mode
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <h1 className="text-title font-medium">Doctor mode is locked</h1>
      <form onSubmit={handleVerifySubmit} className="mt-4 space-y-3">
        <div>
          <label htmlFor="doctor-passcode" className="block text-label text-fg-muted">
            Passcode
          </label>
          <input
            ref={passcodeRef}
            id="doctor-passcode"
            type="password"
            autoComplete="off"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            className="mt-1 w-full rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
          />
        </div>
        {error && <p className="text-label text-warn">{error}</p>}
        <div className="flex items-center gap-4 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-4 py-2 text-label text-white disabled:opacity-60"
          >
            Unlock
          </button>
          <button
            type="button"
            onClick={onBack}
            className="text-label text-fg-muted underline underline-offset-2"
          >
            Back to patient mode
          </button>
        </div>
      </form>
    </div>
  );
}
