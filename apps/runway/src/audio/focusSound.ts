// Focus sound (0.33.0) — the ONE WebAudio choke point in this app. Not
// `lib/` (those files are pure math, DOM-free, Dexie-free — importable from
// a vitest 'node' environment) and not `native/` (that directory is
// reserved for Capacitor plugin bridges; WebAudio is a standard browser API
// with no plugin involved, native or web). This directory exists because
// nothing else in Runway touches AudioContext, and the module-level
// singleton state below (one context, one source, one gain) only makes
// sense concentrated in one place — two independent callers each creating
// their own AudioContext would be a real bug (browsers cap how many can be
// open at once), not just untidy.
//
// WHY THIS EXISTS: Deepak's self-discovered ADHD hack is an unwatched
// YouTube video running in the background while he does unpalatable work —
// non-contingent auditory stimulation, the "moderate brain arousal" effect
// Söderlund's white-noise-in-ADHD studies describe. This gives him that
// mechanism natively during Prüfung sprints and task runs: steady generated
// noise, no video, no feed on the other side trying to win his attention
// back.
//
// UNVERIFIED (needs Deepak's real device, not this dev environment):
//   1. Whether WebView audio keeps playing with the screen off, outside the
//      keep-awake window Sprint.tsx/TaskRun.tsx already hold open while
//      running.
//   2. How this interacts with other audio already playing on the phone —
//      a Capacitor WebView does not request Android audio focus the way a
//      native music app does, so there's no ducking/pausing contract with
//      anything else making sound. Both of these are real gaps, not
//      hand-waved ones; they simply can't be checked from here.

/** The three noise colours on offer. 'brown' is the default (see
 * focusSoundSettings.ts) — the least hissy of the three, judged most
 * comfortable to sit under for a full 50-minute sprint. */
export type FocusSoundKind = 'brown' | 'pink' | 'white';

const BUFFER_SECONDS = 4;

// --- Module-level singleton state -------------------------------------
// Deliberately not wrapped in a class or a factory — there is exactly one
// focus sound in this app (never two overlapping instances), so a plain
// module-scoped set of `let`s is the honest shape rather than a class
// pretending there could be more than one.
let audioContext: AudioContext | null = null;
let sourceNode: AudioBufferSourceNode | null = null;
let gainNode: GainNode | null = null;
let currentKind: FocusSoundKind | null = null;

/**
 * Lazily creates the one AudioContext this module ever owns. Deliberately
 * NOT created at module load / import time: Chrome (and WebView) refuses to
 * let an AudioContext produce sound until it's created or resumed inside a
 * user-gesture call stack, so this only runs the first time `startFocusSound`
 * is actually called — which is always from a tap handler (the Sprint/
 * TaskRun toggle row, or the Settings "retune while playing" path a moment
 * after a tap changed a slider) — never from a mount effect.
 */
function ensureAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

// --- Pure noise generators ----------------------------------------------
// No AudioContext dependency in any of these three — that's deliberate, not
// an oversight: it's what makes them callable from vitest's plain 'node'
// environment (this project's vitest.config.ts has no jsdom, and jsdom
// itself has no AudioContext either way). Each fills/returns a mono
// Float32Array of `n` samples; `startFocusSound` below is the only caller
// that turns the result into an actual AudioBuffer.

/** Uniform white noise: every sample independently drawn from [-1, 1). */
export function whiteNoise(n: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.random() * 2 - 1;
  }
  return out;
}

/**
 * Pink noise via Paul Kellet's "economy" filter approximation of a
 * -3dB/octave (1/f) spectrum — a fixed six-tap running IIR filter over
 * white noise, not the Voss-McCartney octave-summing algorithm. Kellet's
 * version is the one commonly cited as within a fraction of a dB of true
 * pink across the audible range with a single pass over the samples and no
 * extra state beyond six numbers; Voss-McCartney needs an array of
 * per-octave "last values" sized to the noise floor you want, which is
 * more bookkeeping for an accuracy difference nobody sitting under this at
 * low volume for 50 minutes will hear. Coefficients are the commonly
 * published constants for this filter (Kellet's original posting to the
 * music-dsp mailing list); `* 0.11` at the end is the accompanying
 * normalization that keeps the summed taps in roughly the same amplitude
 * neighbourhood as the white noise that feeds them.
 */
export function pinkNoise(n: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    out[i] = pink * 0.11;
  }
  return out;
}

/**
 * Brown (red) noise: a leaky-integrated random walk over white noise. Each
 * sample nudges the running value by a small white-noise step (`* 0.02`,
 * small so the walk doesn't blow past the buffer's useful range before the
 * leak pulls it back) and then decays it by the leak factor (~0.998,
 * i.e. it loses 0.2% each sample) — the leak is what keeps a random walk
 * from drifting off to +/-infinity the way an unleaked integrator would;
 * without it this would need a much more careful (and audible) DC-blocking
 * step instead.
 *
 * Normalization: because the walk's peak amplitude isn't fixed by the
 * formula (it depends on how the random steps happened to add up over this
 * particular run), the raw values are rescaled at the end so the loudest
 * sample sits at ~0.9. Two reasons that number specifically: it leaves a
 * small margin under full scale (1.0) rather than clipping-adjacent, and —
 * the more important reason — it puts brown noise's PEAK in the same
 * neighbourhood as white/pink noise's natural peak (both already sit close
 * to +/-1 by construction), so the volume slider means roughly the same
 * loudness regardless of which kind is selected, instead of brown coming
 * out quieter just because a random walk's raw peak happened to be small
 * this time.
 */
export function brownNoise(n: number): Float32Array<ArrayBuffer> {
  const STEP = 0.02;
  const LEAK = 0.998;
  const out = new Float32Array(n);
  let last = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + white * STEP) * LEAK;
    out[i] = last;
    const abs = Math.abs(last);
    if (abs > peak) peak = abs;
  }
  const scale = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < n; i++) {
    out[i] *= scale;
  }
  return out;
}

function generateSamples(kind: FocusSoundKind, n: number): Float32Array<ArrayBuffer> {
  if (kind === 'white') return whiteNoise(n);
  if (kind === 'pink') return pinkNoise(n);
  return brownNoise(n);
}

/**
 * Builds a looping AudioBuffer for `kind` at the context's own sample rate.
 * ~4 seconds is long enough that the loop point is inaudible as a
 * "beat" or repeating rhythm (the whole point of noise here is that it has
 * none), short enough to generate instantly on a tap.
 *
 * Seamless looping, without a crossfade: white noise's samples are
 * independent draws, so the boundary between the buffer's last sample and
 * its first is statistically no different from any other adjacent pair —
 * there is nothing for a listener to notice AT the seam specifically.
 * Pink and brown noise are filtered/integrated (each sample depends on the
 * ones before it), so in principle the wrap could show a small discontinuity
 * where the filter's internal state doesn't match what came "before" sample
 * 0 on the next lap. In practice this doesn't produce an audible click: both
 * generators are amplitude-bounded (pink by construction, brown by the
 * explicit normalization above) rather than free-running, so the jump at
 * the seam is at most the same order of magnitude as normal sample-to-
 * sample movement elsewhere in the buffer — not a step you can hear
 * against a signal that has no pitch or rhythm to be interrupted. A true
 * crossfade would remove even that theoretical seam, but isn't worth the
 * extra buffer generation for a signal with nothing periodic to protect.
 */
function buildLoopBuffer(ctx: AudioContext, kind: FocusSoundKind): AudioBuffer {
  const frameCount = Math.floor(ctx.sampleRate * BUFFER_SECONDS);
  const samples = generateSamples(kind, frameCount);
  const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

/** Perceptual loudness mapping for the 0-1 volume slider: `gain = volume^2`.
 * Human loudness perception is closer to logarithmic than linear, and a
 * plain `gain = volume` makes the bottom half of a linear slider feel like
 * almost nothing changes while the top half feels too sudden. Squaring is a
 * cheap, well-known approximation of an equal-loudness-step curve — not a
 * precise psychoacoustic model, just good enough that "halfway up the
 * slider" sounds roughly halfway loud. */
function perceptualGain(volume0to1: number): number {
  return volume0to1 * volume0to1;
}

/**
 * Starts (or retunes) the focus sound. Volume is 0-1. Every call to this
 * function must originate from a user gesture (a tap) — see
 * `ensureAudioContext`'s comment above for why.
 *
 * If a sound of the SAME kind is already playing, this retunes in place:
 * only the gain changes, the existing loop keeps playing with no audible
 * restart. If the kind is different (or nothing is playing yet), a fresh
 * AudioBufferSourceNode is built and started.
 *
 * One real WebAudio wrinkle worth being explicit about: the spec says an
 * AudioBufferSourceNode's `.buffer` can only be assigned ONCE — reassigning
 * it on a node that already has one throws. So "swap buffer only if kind
 * changed" cannot literally mean mutating the existing node's buffer in
 * place; it means stopping and discarding the old source node and building
 * a new one, while the GainNode (and the AudioContext itself) are reused
 * untouched. The net effect Deepak hears is the same ("it just changed"),
 * but the implementation underneath is a node swap, not a buffer swap.
 */
export function startFocusSound(kind: FocusSoundKind, volume: number): void {
  try {
    const ctx = ensureAudioContext();
    if (ctx.state === 'suspended') {
      // Best-effort; not awaited. If the context is suspended because this
      // call somehow happened outside a user-gesture stack after all, the
      // catch below still keeps this from throwing — it would just stay
      // silent rather than crash whatever called this.
      void ctx.resume();
    }

    if (!gainNode) {
      gainNode = ctx.createGain();
      gainNode.connect(ctx.destination);
    }
    gainNode.gain.value = perceptualGain(volume);

    if (sourceNode && currentKind === kind) {
      // Same kind already playing - gain above is the whole retune.
      return;
    }

    if (sourceNode) {
      try {
        sourceNode.stop();
      } catch {
        // Already stopped - fine, we're replacing it either way.
      }
      sourceNode.disconnect();
    }

    const buffer = buildLoopBuffer(ctx, kind);
    const newSource = ctx.createBufferSource();
    newSource.buffer = buffer;
    newSource.loop = true;
    newSource.connect(gainNode);
    newSource.start();

    sourceNode = newSource;
    currentKind = kind;
  } catch {
    // A WebAudio hiccup (autoplay policy, a context in a weird state, an
    // unsupported browser) must never be the reason a sprint or task fails
    // to start - the sound is a nice-to-have layered on top of the timer,
    // never load-bearing for it.
  }
}

/**
 * Whether the engine is actively producing sound right now. Settings.tsx is
 * the one caller: it needs to tell "retune the sound that's already
 * playing" (a sprint or task left running while Settings happens to be
 * open) apart from "nothing is playing, so leave it alone" — Settings has
 * no enable toggle of its own (see its "Focus sound" section's own
 * comment), so a kind/volume change there must never be what STARTS the
 * engine.
 */
export function isFocusSoundPlaying(): boolean {
  return sourceNode !== null;
}

/**
 * Stops the focus sound, if any is playing. Idempotent (safe to call when
 * nothing is playing, or repeatedly) and never throws - called
 * unconditionally from every exit path of a running sprint/task (finish,
 * abandon, unmount), so a crash here would risk taking a real state
 * transition down with it.
 */
export function stopFocusSound(): void {
  try {
    sourceNode?.stop();
    sourceNode?.disconnect();
    gainNode?.disconnect();
  } catch {
    // An AudioContext in a weird state (e.g. already closed) must never
    // crash a finish/abandon path - this is best-effort cleanup only.
  } finally {
    sourceNode = null;
    gainNode = null;
    currentKind = null;
  }
}
