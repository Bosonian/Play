import { describe, expect, it } from 'vitest';
import { brownNoise, pinkNoise, whiteNoise } from './focusSound';

// These three generators are the entire testable surface of focusSound.ts -
// everything else in that file touches a real AudioContext, which doesn't
// exist in this project's plain 'node' vitest environment (see
// vitest.config.ts). Determinism is deliberately NOT asserted anywhere
// here (each generator draws from Math.random()) - these tests check the
// STATISTICAL/boundedness properties the WebAudio buffer consumer actually
// depends on, not any particular sample sequence.

describe('whiteNoise', () => {
  it('returns exactly n samples', () => {
    expect(whiteNoise(1000)).toHaveLength(1000);
  });

  it('every sample lands in [-1, 1)', () => {
    const samples = whiteNoise(50_000);
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(-1);
      expect(s).toBeLessThan(1);
    }
  });

  it('handles n = 0 without error', () => {
    expect(whiteNoise(0)).toHaveLength(0);
  });
});

describe('pinkNoise', () => {
  it('returns exactly n samples', () => {
    expect(pinkNoise(1000)).toHaveLength(1000);
  });

  it('stays finite and bounded over 1e6 samples (filter stability)', () => {
    // The Paul Kellet filter is a stable IIR filter (every pole has
    // magnitude < 1) driven by bounded [-1, 1) white noise, so its output
    // should never blow up no matter how long it runs - this is the
    // property that actually matters for a loop meant to play for an
    // entire sprint, not just a few seconds.
    const samples = pinkNoise(1_000_000);
    let maxAbs = 0;
    for (const s of samples) {
      expect(Number.isFinite(s)).toBe(true);
      const abs = Math.abs(s);
      if (abs > maxAbs) maxAbs = abs;
    }
    // Generous bound - the filter's gain-compensated output should sit
    // comfortably within a couple of units of full scale, nowhere near
    // diverging.
    expect(maxAbs).toBeLessThan(2);
    expect(maxAbs).toBeGreaterThan(0);
  });

  it('handles n = 0 without error', () => {
    expect(pinkNoise(0)).toHaveLength(0);
  });
});

describe('brownNoise', () => {
  it('returns exactly n samples', () => {
    expect(brownNoise(1000)).toHaveLength(1000);
  });

  it('normalizes its peak to ~0.9', () => {
    const samples = brownNoise(100_000);
    let maxAbs = 0;
    for (const s of samples) {
      const abs = Math.abs(s);
      if (abs > maxAbs) maxAbs = abs;
    }
    // The loudest sample in the buffer should land essentially exactly at
    // the normalization target - floating point only, no tolerance needed
    // beyond that.
    expect(maxAbs).toBeCloseTo(0.9, 5);
  });

  it('stays finite and within the normalized range for every sample', () => {
    const samples = brownNoise(100_000);
    for (const s of samples) {
      expect(Number.isFinite(s)).toBe(true);
      // 1e-6, not 1e-9: the scale factor is computed in float64 but each
      // sample is STORED into a Float32Array, whose ~7 significant decimal
      // digits can round the peak sample a few 1e-8 above an exact 0.9
      // (observed flake: 0.9000000357...). The property that matters is
      // "comfortably below full scale (1.0)", not "exactly 0.9" - the
      // tolerance only needs to absorb float32 quantization.
      expect(Math.abs(s)).toBeLessThanOrEqual(0.9 + 1e-6);
    }
  });

  it('handles n = 0 without dividing by zero', () => {
    // peak stays 0 for an empty walk - the normalization guard
    // (`peak > 0 ? 0.9 / peak : 1`) exists specifically for this case.
    expect(brownNoise(0)).toHaveLength(0);
  });

  it('handles n = 1 without a degenerate normalization', () => {
    // A single sample IS the peak, so normalizing scales it to exactly
    // +/-0.9 - this exercises the same guard as n=0 from the other side.
    const samples = brownNoise(1);
    expect(Math.abs(samples[0])).toBeCloseTo(0.9, 5);
  });
});
