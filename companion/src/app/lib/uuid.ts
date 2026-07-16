// UUID with a fallback. Cloned from the root Head-in app's
// src/engine/study.ts (see `safeUuid` there, lines ~35-43) — same rationale
// applies here: crypto.randomUUID exists in secure contexts on modern
// browsers, but not in every Android WebView / older engine, and calling it
// when absent throws rather than returning undefined.
export function safeUuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Non-cryptographic fallback; fine for a local event id.
  return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
