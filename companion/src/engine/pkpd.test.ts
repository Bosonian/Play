import { describe, it, expect } from 'vitest';
import {
  batemanConc,
  tmax,
  simulate,
  stateIntervals,
  doseResponses,
  estimateOnThreshold,
  DEFAULT_PK,
  type DiaryObservation,
} from './pkpd';

describe('PK — Bateman single dose', () => {
  it('is zero before and at the dose', () => {
    expect(batemanConc(100, -1)).toBe(0);
    expect(batemanConc(100, 0)).toBe(0);
  });

  it('rises then falls, peaking near Tmax', () => {
    const peakT = tmax();
    const atPeak = batemanConc(100, peakT);
    expect(atPeak).toBeGreaterThan(batemanConc(100, peakT - 0.4));
    expect(atPeak).toBeGreaterThan(batemanConc(100, peakT + 0.4));
    expect(peakT).toBeGreaterThan(0.3);
    expect(peakT).toBeLessThan(1.2); // levodopa IR Tmax ~0.5–1 h
  });

  it('scales linearly with dose', () => {
    expect(batemanConc(200, 0.7)).toBeCloseTo(2 * batemanConc(100, 0.7), 6);
  });
});

describe('PK — superposition', () => {
  it('two doses sum at each time point', () => {
    const sim = simulate(
      [
        { tHours: 0, doseMg: 100 },
        { tHours: 4, doseMg: 100 },
      ],
      { startH: 0, endH: 6 },
    );
    const at5 = sim.find((p) => Math.abs(p.tHours - 5) < 1e-3)!;
    const expected = batemanConc(100, 5) + batemanConc(100, 1);
    expect(at5.plasma).toBeCloseTo(expected, 6);
  });
});

describe('PD — effect compartment lags plasma', () => {
  it('effect peak occurs later than plasma peak', () => {
    const sim = simulate([{ tHours: 0, doseMg: 150 }], { startH: 0, endH: 6 });
    const plasmaPeak = sim.reduce((a, b) => (b.plasma > a.plasma ? b : a));
    const effectPeak = sim.reduce((a, b) => (b.effect > a.effect ? b : a));
    expect(effectPeak.tHours).toBeGreaterThan(plasmaPeak.tHours);
  });
});

describe('Clinical state + dose response', () => {
  it('detects an ON interval and a wear-off after a single dose', () => {
    const sim = simulate([{ tHours: 0, doseMg: 150 }], { startH: 0, endH: 8 });
    // Choose a threshold below the effect peak so the patient goes ON then OFF.
    const peak = Math.max(...sim.map((p) => p.effect));
    const onThreshold = peak * 0.5;
    const dyskThreshold = peak * 1.5; // no dyskinesia in this scenario

    const intervals = stateIntervals(sim, onThreshold, dyskThreshold);
    const states = intervals.map((i) => i.state);
    expect(states).toContain('on');
    // Should start OFF, become ON, and return OFF as it wears off.
    expect(states[0]).toBe('off');
    expect(states[states.length - 1]).toBe('off');
    expect(states).not.toContain('on-dyskinesia');

    const [resp] = doseResponses([{ tHours: 0, doseMg: 150 }], sim, onThreshold);
    expect(resp.onsetH).not.toBeNull();
    expect(resp.wearOffLatencyH).not.toBeNull();
    expect(resp.wearOffLatencyH!).toBeGreaterThan(1); // benefit lasts a while
  });

  it('flags a dose failure when the ON threshold is never reached', () => {
    const sim = simulate([{ tHours: 0, doseMg: 50 }], { startH: 0, endH: 8 });
    const peak = Math.max(...sim.map((p) => p.effect));
    const onThreshold = peak * 2; // unreachable → failure
    const [resp] = doseResponses([{ tHours: 0, doseMg: 50 }], sim, onThreshold);
    expect(resp.onsetH).toBeNull();
    expect(resp.wearOffLatencyH).toBeNull();
  });
});

describe('Individualization — estimate ON threshold from a diary', () => {
  it('recovers a known threshold from a clean synthetic diary', () => {
    const sim = simulate([{ tHours: 0, doseMg: 150 }], { startH: 0, endH: 8, pk: DEFAULT_PK });
    const trueThreshold = Math.max(...sim.map((p) => p.effect)) * 0.5;
    // Build ON/OFF observations from the true threshold.
    const obs: DiaryObservation[] = sim
      .filter((_, i) => i % 20 === 0) // sample every ~20 min
      .map((p) => ({ tHours: p.tHours, isOn: p.effect >= trueThreshold }));

    const est = estimateOnThreshold(sim, obs)!;
    expect(est).not.toBeNull();
    // Within 15% of the true threshold.
    expect(Math.abs(est - trueThreshold) / trueThreshold).toBeLessThan(0.15);
  });

  it('returns null without both ON and OFF data', () => {
    const sim = simulate([{ tHours: 0, doseMg: 150 }], { startH: 0, endH: 8 });
    expect(estimateOnThreshold(sim, [{ tHours: 1, isOn: true }])).toBeNull();
  });
});
