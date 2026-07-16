// Doctor-mode passcode gate.
//
// WHAT THIS PROTECTS: nothing, yet. This increment ships no doctor data — the
// gate exists so the *shape* of doctor access (a passcode local to this
// device) is in place before there's anything behind it. The threat model is
// narrow: someone who has the patient's unlocked phone in hand and pokes at
// localStorage. That is NOT a security boundary against a determined
// attacker with the device; it just raises the cost of casually wandering
// into doctor mode.
//
// WHY PBKDF2 (not SHA-256 + salt): SubtleCrypto's deriveBits with PBKDF2 is
// the only purpose-built key-derivation function the Web Crypto API exposes.
// A general-purpose hash like SHA-256 is fast by design, which is exactly
// wrong for a passcode check — fast means cheap to brute-force offline.
// PBKDF2's iteration count is deliberate key-stretching: it makes each guess
// cost real CPU time. It does not fix a weak passcode; it raises the cost of
// trying many.
//
// THE REAL CEILING is passcode entropy, not the KDF. A 6-character passcode
// has a small search space no iteration count meaningfully protects against
// an attacker willing to spend GPU time. 210,000 iterations (OWASP's current
// PBKDF2-HMAC-SHA256 baseline) is a reasonable default, not a guarantee.

export interface PasscodeRecord {
  version: 1;
  algorithm: 'PBKDF2-HMAC-SHA256';
  iterations: number;
  saltB64: string;
  hashB64: string;
}

export const MIN_PASSCODE_LENGTH = 6;

const ITERATIONS = 210_000;
const HASH_BITS = 256;
const SALT_BYTES = 16;

// localStorage, not IndexedDB: this is one small synchronous config record,
// not patient data. Patient events (when they arrive in a later increment)
// go into IndexedDB like the rest of the app's data; this key is the one
// deliberate exception because it needs to be readable before any async DB
// open completes (DoctorGate reads it on mount).
const STORAGE_KEY = 'companion.doctorGate.v1';

function bytesToBase64(bytes: Uint8Array): string {
  // btoa/atob operate on binary strings, not raw bytes — this is the
  // standard bridge, and it works identically in the browser and in Node 20+
  // (so the same code runs under vitest without a polyfill).
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Derive a PBKDF2-HMAC-SHA256 hash for `passcode`. The passcode is used
// verbatim — no trim, no case-folding. Silently normalizing user input is a
// usability nicety for *display* text, not for a secret: trimming a
// passcode the patient/doctor typed with trailing intent (e.g. deliberately
// including a space) would make the record wrong in a way that's invisible
// until the next login fails.
export async function derivePasscodeHash(
  passcode: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passcode),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    // The `as BufferSource` cast is TypeScript 5.7+ noise, not a real type
    // hole: lib.dom's typed-array generics changed so a bare `Uint8Array`
    // parameter (as specced) types as `Uint8Array<ArrayBufferLike>`, which
    // includes SharedArrayBuffer and no longer structurally matches
    // `BufferSource`. The salt is always a plain ArrayBuffer-backed
    // Uint8Array at runtime (see createPasscodeRecord/base64ToBytes).
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export async function createPasscodeRecord(passcode: string): Promise<PasscodeRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derivePasscodeHash(passcode, salt, ITERATIONS);
  return {
    version: 1,
    algorithm: 'PBKDF2-HMAC-SHA256',
    iterations: ITERATIONS,
    saltB64: bytesToBase64(salt),
    hashB64: bytesToBase64(hash),
  };
}

export async function verifyPasscode(passcode: string, record: PasscodeRecord): Promise<boolean> {
  const salt = base64ToBytes(record.saltB64);
  const hash = await derivePasscodeHash(passcode, salt, record.iterations);
  // Comparing base64 strings, not a constant-time byte comparison: an
  // attacker who can time this comparison already has the record itself
  // (it's sitting in localStorage on the device they're holding), so timing
  // resistance buys nothing here that possession of the record doesn't
  // already give them.
  return bytesToBase64(hash) === record.hashB64;
}

// JSON.parse in a try/catch; anything that doesn't parse, or doesn't look
// like a PasscodeRecord, is treated as "no passcode set" rather than thrown.
// Tradeoff: a corrupted record silently falls back to the set flow, which
// means a doctor whose stored record got mangled (e.g. a botched manual edit
// of localStorage) loses their passcode without an explicit error message.
// Accepted for now because there is no recovery flow either way — see below.
export function loadPasscodeRecord(): PasscodeRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as PasscodeRecord).version === 1 &&
      (parsed as PasscodeRecord).algorithm === 'PBKDF2-HMAC-SHA256' &&
      typeof (parsed as PasscodeRecord).iterations === 'number' &&
      typeof (parsed as PasscodeRecord).saltB64 === 'string' &&
      typeof (parsed as PasscodeRecord).hashB64 === 'string'
    ) {
      return parsed as PasscodeRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export function savePasscodeRecord(record: PasscodeRecord): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

// NO RECOVERY FLOW: forgetting the passcode means clearing the storage key
// (browser devtools, or uninstalling the app) and setting a new one. That
// costs nothing today because doctor mode holds no data yet. Once doctor
// mode stores anything, "forgot passcode = start over" stops being free, and
// a deliberate reset flow (with whatever tradeoff that implies — a recovery
// code? doctor identity elsewhere?) becomes a real decision, not a default.
