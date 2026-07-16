// Pure math core for Steady Read's gyro-based display stabilization.
//
// No DOM, no DeviceMotion here — every time step is injected via
// GyroSample.dt so this module is deterministic and testable without a
// browser. The real app drives it from a rAF loop reading the latest sample
// off a ref (see useDeviceMotion.ts / SteadyRead.tsx); this file never knows
// that a phone, a screen, or a sensor exists.
//
// WHAT THIS CANCELS (be honest about it): only ROTATIONAL tremor — the
// phone's rotation about its own axes, as reported by the gyroscope. A
// gyroscope reports angular rate, not position, so it can never recover
// pure translation (the hand shaking the phone sideways with no rotation
// component). Integrating the accelerometer for that is a well-known trap:
// double-integrating noisy accelerometer data to get position drifts
// unboundedly within seconds, so it is not attempted here. This is also
// strictly display-side: it steadies only the content this app renders,
// never other apps, the OS, or a camera feed.
//
// FILTER RATIONALE (leaky integrator = a bounded high-pass on angle): a
// hand tremor lives at roughly 4-8 Hz. If angular rate were integrated to
// angle directly (a plain integrator), two things would go wrong: slow
// deliberate reorientation (moving the phone to a comfortable position)
// would register as a growing offset that the stabilizer fights forever,
// and any small constant sensor bias would integrate into permanent drift.
// Instead each axis keeps a "leaky" running state: every step it decays
// toward zero by a factor `a = tau/(tau+dt)` before adding the new
// `rate*dt` contribution — the same shape as a discrete-time RC high-pass.
// For a frequency well above cutoffHz, decay-per-sample is small relative
// to the input, so the fast tremor content mostly survives (passed). For a
// *constant* rate, the state does not run away — it settles to a bounded
// steady state (state_ss ~= rate * tau) instead of growing forever, and at
// exactly zero rate it decays to zero. cutoffHz sets tau = 1/(2*PI*cutoffHz):
// content well above cutoffHz is passed through for cancellation, content
// well below it (slow reorientation, drift, sensor bias) is attenuated and
// bounded. This is what keeps the counter-shift from drifting and from
// fighting the patient's own deliberate movement.

export interface StabilizerConfig {
  cutoffHz: number;
  strengthPxPerRad: number;
  maxOffsetPx: number;
}

// rad/s for the rates; dt in seconds. Unit conversion (deg/s -> rad/s off
// the raw DeviceMotion event) happens at the useDeviceMotion hook boundary,
// not here — this module only ever sees SI units so its math can't be
// silently wrong by a factor of pi/180.
export interface GyroSample {
  rateXRadS: number;
  rateYRadS: number;
  rateZRadS: number;
  dt: number;
}

export interface Transform {
  xPx: number;
  yPx: number;
  rollDeg: number;
}

// SPEC RISK: axis polarity (does a positive gyro rate need a positive or
// negative counter-shift?) is unverifiable in this sandbox — it depends on
// how the Android WebView reports DeviceMotion axes relative to the
// on-screen content, which can only be confirmed by holding the built APK
// and watching whether the stabilization moves the text the right way.
// Every sign decision funnels through this one object on purpose: if the
// on-device sign turns out flipped for an axis, the fix is a one-character
// edit here, never a hunt through update()'s arithmetic.
export const AXIS_SIGN = {
  x: 1,
  y: 1,
  roll: 1,
} as const;

function clamp(value: number, maxAbs: number): number {
  if (maxAbs <= 0) return 0;
  if (value > maxAbs) return maxAbs;
  if (value < -maxAbs) return -maxAbs;
  // Normalize -0 to 0: sign * 0 produces -0 in JS, and while it's == 0 it
  // fails Object.is-based equality (used by toEqual/toBe in tests) and can
  // read oddly if ever logged. Not a functional bug (translate3d(-0px, ...)
  // renders identically), just avoiding a needless surprise.
  return value === 0 ? 0 : value;
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

const IDENTITY_TRANSFORM: Transform = { xPx: 0, yPx: 0, rollDeg: 0 };

export class Stabilizer {
  private config: StabilizerConfig;

  // Per-axis leaky-integrator state, in radians (or rad-equivalent for
  // roll). Not exposed — the only way in is update(), the only way to zero
  // it is reset().
  private stateX = 0;
  private stateY = 0;
  private stateZ = 0;

  private lastTransform: Transform = IDENTITY_TRANSFORM;

  constructor(config: StabilizerConfig) {
    this.config = config;
  }

  update(sample: GyroSample): Transform {
    // A zero or negative dt means the caller couldn't establish a real
    // interval yet (e.g. the very first DeviceMotion event, or a clock
    // hiccup). Integrating against it would divide-by-zero the leak
    // coefficient or run time backwards, so hold the previous transform
    // rather than let one bad sample glitch the rendered offset.
    if (sample.dt <= 0) {
      return this.lastTransform;
    }

    const tau = 1 / (2 * Math.PI * this.config.cutoffHz);
    const a = tau / (tau + sample.dt);

    this.stateX = a * (this.stateX + sample.rateXRadS * sample.dt);
    this.stateY = a * (this.stateY + sample.rateYRadS * sample.dt);
    this.stateZ = a * (this.stateZ + sample.rateZRadS * sample.dt);

    const { strengthPxPerRad, maxOffsetPx } = this.config;

    // Translation counters device pitch/yaw (rotation about the screen's
    // X/Y axes, which slides the apparent content up/down/left/right).
    // Roll counters rotation about the screen's own normal (Z) axis, which
    // is a twist in the plane of the screen, not a slide — so it maps to a
    // counter-rotation of the content, not a third offset.
    const xPx = clamp(-AXIS_SIGN.x * strengthPxPerRad * this.stateX, maxOffsetPx);
    const yPx = clamp(-AXIS_SIGN.y * strengthPxPerRad * this.stateY, maxOffsetPx);
    const rollDeg = normalizeZero(-AXIS_SIGN.roll * radToDeg(this.stateZ));

    this.lastTransform = { xPx, yPx, rollDeg };
    return this.lastTransform;
  }

  // Called on toggle-off (and before a fresh Begin) so no stale offset from
  // a previous session can linger into the next.
  reset(): void {
    this.stateX = 0;
    this.stateY = 0;
    this.stateZ = 0;
    this.lastTransform = IDENTITY_TRANSFORM;
  }

  // Sliders call this on every change; a partial update so one slider
  // moving doesn't require the caller to re-supply the other two.
  setConfig(cfg: Partial<StabilizerConfig>): void {
    this.config = { ...this.config, ...cfg };
  }
}
