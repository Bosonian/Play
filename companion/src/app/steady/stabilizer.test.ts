import { describe, it, expect } from 'vitest';
import { Stabilizer, type Transform } from './stabilizer';

const DT = 1 / 60; // matches the ~60 Hz nominal DeviceMotion rate (RESEARCH.md §6)

function driveConstant(rateXRadS: number, steps: number, config = defaultConfig()): number[] {
  const stabilizer = new Stabilizer(config);
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    out.push(stabilizer.update({ rateXRadS, rateYRadS: 0, rateZRadS: 0, dt: DT }).xPx);
  }
  return out;
}

function defaultConfig() {
  return { cutoffHz: 0.8, strengthPxPerRad: 3000, maxOffsetPx: 1000 };
}

describe('Stabilizer — leaky-integrator counter-shift (pure math, no DOM)', () => {
  it('counter-phases a 5 Hz tremor: non-trivial amplitude, near-zero mean, opposite sign to the driving angle', () => {
    // rate(t) is the derivative of angle(t) = A*sin(2*pi*f*t), so feeding
    // this rate is equivalent to "the phone's angle is a 5 Hz sinusoid of
    // amplitude A" — a plausible hand-tremor swing (~2.9 degrees).
    const A = 0.05;
    const f = 5;
    const stabilizer = new Stabilizer(defaultConfig());

    const seconds = 2;
    const steps = Math.round(seconds / DT);
    const xs: number[] = [];
    const angles: number[] = [];
    for (let i = 0; i < steps; i++) {
      const t = i * DT;
      const rateXRadS = A * 2 * Math.PI * f * Math.cos(2 * Math.PI * f * t);
      xs.push(stabilizer.update({ rateXRadS, rateYRadS: 0, rateZRadS: 0, dt: DT }).xPx);
      angles.push(A * Math.sin(2 * Math.PI * f * t));
    }

    // Drop the first quarter second: the leaky integrator has a brief
    // startup transient before it settles into periodic steady state.
    const settleFrom = Math.round(0.25 / DT);
    const steadyX = xs.slice(settleFrom);
    const steadyAngle = angles.slice(settleFrom);

    const mean = steadyX.reduce((sum, v) => sum + v, 0) / steadyX.length;
    const amplitude = (Math.max(...steadyX) - Math.min(...steadyX)) / 2;

    // Passed, not attenuated to nothing: 5 Hz is well above the 0.8 Hz
    // cutoff, so most of the swing should survive as a counter-offset.
    expect(amplitude).toBeGreaterThan(20);
    // No drift: the oscillation is centered near zero, not wandering off.
    expect(Math.abs(mean)).toBeLessThan(amplitude * 0.2);

    // Opposite sign to the driving angle: correlate the two series and
    // expect a clearly negative result (counter-phase, not in-phase).
    let dot = 0;
    for (let i = 0; i < steadyX.length; i++) dot += steadyX[i] * steadyAngle[i];
    expect(dot).toBeLessThan(0);
  });

  it('does not drift under constant slow rotation: settles to a bounded value instead of ramping', () => {
    // A steady 0.17 rad/s (~10 deg/s) reorientation, sustained well past
    // the filter's ~1 s settling time (5*tau at cutoffHz=0.8).
    const xs = driveConstant(0.17, 500);
    expect(Math.abs(xs[400] - xs[200])).toBeLessThan(0.01);
    // Bounded well inside the configured clamp, i.e. this is genuine
    // filter settling, not the clamp silently doing the work.
    expect(Math.abs(xs[400])).toBeLessThan(defaultConfig().maxOffsetPx);
  });

  it('clamps to the overscan limit under a large sustained transient', () => {
    const maxOffsetPx = 50;
    const xs = driveConstant(5, 300, { cutoffHz: 0.8, strengthPxPerRad: 3000, maxOffsetPx });
    const last = xs[xs.length - 1];
    expect(Math.abs(last)).toBeLessThanOrEqual(maxOffsetPx);
    // Confirms the transient really was large enough to hit the clamp
    // (rather than merely staying under it by chance).
    expect(Math.abs(last)).toBeCloseTo(maxOffsetPx, 5);
  });

  it('is identity on zero input, and returns to identity state after reset()', () => {
    const stabilizer = new Stabilizer(defaultConfig());
    const zero = stabilizer.update({ rateXRadS: 0, rateYRadS: 0, rateZRadS: 0, dt: DT });
    expect(zero).toEqual<Transform>({ xPx: 0, yPx: 0, rollDeg: 0 });

    for (let i = 0; i < 60; i++) {
      stabilizer.update({ rateXRadS: 1, rateYRadS: 1, rateZRadS: 1, dt: DT });
    }
    stabilizer.reset();
    const afterReset = stabilizer.update({ rateXRadS: 0, rateYRadS: 0, rateZRadS: 0, dt: DT });
    expect(afterReset).toEqual<Transform>({ xPx: 0, yPx: 0, rollDeg: 0 });
  });

  it('maps roll (Z rotation) to rotation only, and X rotation to translation only', () => {
    const roll = new Stabilizer(defaultConfig());
    let rollTransform: Transform | undefined;
    for (let i = 0; i < 30; i++) {
      rollTransform = roll.update({ rateXRadS: 0, rateYRadS: 0, rateZRadS: 0.5, dt: DT });
    }
    expect(rollTransform!.xPx).toBe(0);
    expect(rollTransform!.yPx).toBe(0);
    expect(rollTransform!.rollDeg).not.toBe(0);
    // A positive Z rate should produce a counter-rotation of the opposite sign.
    expect(Math.sign(rollTransform!.rollDeg)).toBe(-1);

    const translate = new Stabilizer(defaultConfig());
    let translateTransform: Transform | undefined;
    for (let i = 0; i < 30; i++) {
      translateTransform = translate.update({ rateXRadS: 0.5, rateYRadS: 0, rateZRadS: 0, dt: DT });
    }
    expect(translateTransform!.rollDeg).toBe(0);
    expect(translateTransform!.xPx).not.toBe(0);
  });

  it('holds the last transform (no glitch) when dt is zero or negative', () => {
    const stabilizer = new Stabilizer(defaultConfig());
    const warm = stabilizer.update({ rateXRadS: 1, rateYRadS: 0, rateZRadS: 0, dt: DT });
    expect(warm.xPx).not.toBe(0);

    const held = stabilizer.update({ rateXRadS: 999, rateYRadS: 999, rateZRadS: 999, dt: 0 });
    expect(held).toEqual(warm);

    const heldNegative = stabilizer.update({ rateXRadS: 999, rateYRadS: 999, rateZRadS: 999, dt: -0.5 });
    expect(heldNegative).toEqual(warm);
  });

  it('setConfig updates tunables live without requiring a new instance', () => {
    const stabilizer = new Stabilizer({ cutoffHz: 0.8, strengthPxPerRad: 1000, maxOffsetPx: 1000 });
    const before = stabilizer.update({ rateXRadS: 0.5, rateYRadS: 0, rateZRadS: 0, dt: DT });

    const stronger = new Stabilizer({ cutoffHz: 0.8, strengthPxPerRad: 1000, maxOffsetPx: 1000 });
    stronger.setConfig({ strengthPxPerRad: 3000 });
    const after = stronger.update({ rateXRadS: 0.5, rateYRadS: 0, rateZRadS: 0, dt: DT });

    // Same input, 3x the strength, should produce a 3x larger (unclamped) offset.
    expect(Math.abs(after.xPx)).toBeCloseTo(Math.abs(before.xPx) * 3, 6);
  });
});
