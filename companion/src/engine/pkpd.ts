// Transparent levodopa PK/PD engine.
//
// This is deliberately a WHITE-BOX, mechanistic model, not machine learning.
// For a single patient the diary is n-of-1 and noisy; a black box would overfit
// and hand a clinician false precision. A transparent model produces outputs a
// neurologist can inspect and overrule. ML, if ever added, belongs later on
// POOLED data and should stay interpretable.
//
// MODEL
//  - PK: one-compartment oral (Bateman) with first-order absorption ka and
//    elimination ke; doses superpose linearly. Levodopa's short t½ (~1.5 h)
//    makes IR dosing well suited to this.
//  - PD: an EFFECT compartment (rate ke0) captures the lag/hysteresis between
//    plasma level and clinical benefit — levodopa shows counter-clockwise
//    hysteresis, so effect trails plasma. Clinical state is read off the
//    effect-site concentration against two individualized thresholds.
//
// ASSUMPTIONS & LIMITS (stated honestly — this is built for a clinician):
//  - Population PK defaults; individualization here is of the PD thresholds
//    only. Per-patient PK (absorption variability, gastric emptying) is not yet
//    fitted — a known gap, flagged rather than hidden.
//  - Linear superposition assumes no saturation over the usual range.
//  - Concentrations are in mg/L using population parameters, but should be read
//    as RELATIVE — the clinically meaningful quantities are the timing (when ON
//    begins, how long it lasts) and the threshold crossings, not the absolute
//    number.
//  - IR only in v1. CR/ER absorption differs and is not yet modelled.
//  - Protein/meal effects on absorption are surfaced descriptively elsewhere,
//    not yet folded into ka.

// Population PK defaults for levodopa (with carbidopa), immediate release.
export interface PkParams {
  ka: number; // absorption rate constant (1/h)
  ke: number; // elimination rate constant (1/h)
  ke0: number; // effect-compartment equilibration rate (1/h)
  F: number; // bioavailability (with carbidopa)
  Vd: number; // apparent volume of distribution (L)
}

export const DEFAULT_PK: PkParams = {
  ka: 2.0, // Tmax ~0.5–1 h
  ke: Math.LN2 / 1.5, // t½ ≈ 1.5 h  → ~0.462 /h
  ke0: 0.7, // effect lag on the order of tens of minutes
  F: 0.84, // carbidopa raises central availability
  Vd: 70, // ~1 L/kg
};

// Plasma concentration (mg/L) at time `t` hours after a single oral dose, via
// the Bateman equation. Zero before the dose.
export function batemanConc(doseMg: number, t: number, p: PkParams = DEFAULT_PK): number {
  if (t <= 0) return 0;
  const { ka, ke, F, Vd } = p;
  // Guard the ka==ke degenerate case (would divide by zero).
  if (Math.abs(ka - ke) < 1e-6) {
    return ((F * doseMg) / Vd) * ka * t * Math.exp(-ke * t);
  }
  return (
    ((F * doseMg * ka) / (Vd * (ka - ke))) *
    (Math.exp(-ke * t) - Math.exp(-ka * t))
  );
}

// Time (h) of peak plasma concentration after a single dose: Tmax.
export function tmax(p: PkParams = DEFAULT_PK): number {
  const { ka, ke } = p;
  if (Math.abs(ka - ke) < 1e-6) return 1 / ke;
  return Math.log(ka / ke) / (ka - ke);
}

export interface DoseInput {
  tHours: number; // dose time in hours from the simulation origin
  doseMg: number; // levodopa mg
}

export interface SimPoint {
  tHours: number;
  plasma: number; // mg/L, summed over all doses
  effect: number; // effect-site concentration (drives clinical state)
}

// Simulate plasma + effect-site concentration over a time grid. Effect site is
// integrated with a simple forward-Euler step: dCe/dt = ke0 (Cp − Ce).
export function simulate(
  doses: DoseInput[],
  opts: { startH: number; endH: number; stepH?: number; pk?: PkParams },
): SimPoint[] {
  const pk = opts.pk ?? DEFAULT_PK;
  const step = opts.stepH ?? 1 / 60; // 1-minute resolution
  const out: SimPoint[] = [];
  let ce = 0;
  let prevPlasma = 0;
  let first = true;
  for (let t = opts.startH; t <= opts.endH + 1e-9; t += step) {
    const plasma = doses.reduce((sum, d) => sum + batemanConc(d.doseMg, t - d.tHours, pk), 0);
    if (first) {
      first = false;
    } else {
      // integrate effect site using the previous plasma value
      ce += step * pk.ke0 * (prevPlasma - ce);
      if (ce < 0) ce = 0;
    }
    prevPlasma = plasma;
    out.push({ tHours: round(t), plasma, effect: ce });
  }
  return out;
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Reading clinical state off the simulation
// ---------------------------------------------------------------------------
export type ClinicalState = 'off' | 'on' | 'on-dyskinesia';

export function stateAt(effect: number, onThreshold: number, dyskThreshold: number): ClinicalState {
  if (effect >= dyskThreshold) return 'on-dyskinesia';
  if (effect >= onThreshold) return 'on';
  return 'off';
}

export interface StateInterval {
  state: ClinicalState;
  startH: number;
  endH: number;
}

// Collapse the per-point states into contiguous intervals.
export function stateIntervals(
  sim: SimPoint[],
  onThreshold: number,
  dyskThreshold: number,
): StateInterval[] {
  const intervals: StateInterval[] = [];
  for (const pt of sim) {
    const s = stateAt(pt.effect, onThreshold, dyskThreshold);
    const last = intervals[intervals.length - 1];
    if (last && last.state === s) {
      last.endH = pt.tHours;
    } else {
      intervals.push({ state: s, startH: pt.tHours, endH: pt.tHours });
    }
  }
  return intervals;
}

export interface DoseResponse {
  doseTimeH: number;
  onsetH: number | null; // time of ON onset after the dose (null = dose failure)
  wearOffLatencyH: number | null; // dose → return to OFF (null = still ON at window end)
}

// Per-dose response: when ON begins after each dose and how long benefit lasts.
// "Dose failure" = the effect site never reaches the ON threshold after a dose
// (clinically often delayed/failed absorption, e.g. protein or gastric).
export function doseResponses(
  doses: DoseInput[],
  sim: SimPoint[],
  onThreshold: number,
): DoseResponse[] {
  const sorted = [...doses].sort((a, b) => a.tHours - b.tHours);
  return sorted.map((d, i) => {
    const nextDoseH = sorted[i + 1]?.tHours ?? Infinity;
    const windowEnd = Math.min(nextDoseH, sim[sim.length - 1]?.tHours ?? d.tHours);
    // Onset: first point at/after this dose where effect crosses ON.
    let onsetH: number | null = null;
    for (const pt of sim) {
      if (pt.tHours < d.tHours || pt.tHours > windowEnd) continue;
      if (pt.effect >= onThreshold) {
        onsetH = pt.tHours;
        break;
      }
    }
    // Wear-off: first point after onset where effect drops back below ON.
    let wearOffLatencyH: number | null = null;
    if (onsetH !== null) {
      for (const pt of sim) {
        if (pt.tHours <= onsetH) continue;
        if (pt.effect < onThreshold) {
          wearOffLatencyH = round(pt.tHours - d.tHours);
          break;
        }
      }
    }
    return { doseTimeH: d.tHours, onsetH, wearOffLatencyH };
  });
}

// ---------------------------------------------------------------------------
// Individualizing the ON threshold from the patient's own diary
// ---------------------------------------------------------------------------
export interface DiaryObservation {
  tHours: number;
  isOn: boolean; // true if the patient reported ON (or ON-with-dyskinesia)
}

// Estimate the effect-site ON threshold that best separates the patient's
// observed ON vs OFF reports against the simulated effect curve. A transparent
// grid search over candidate thresholds, picking the one with the fewest
// misclassifications (ties → the lower threshold, the more conservative call
// that a given level counts as ON). Returns null if there isn't ON and OFF data
// to separate.
export function estimateOnThreshold(
  sim: SimPoint[],
  observations: DiaryObservation[],
): number | null {
  if (observations.length === 0) return null;
  const hasOn = observations.some((o) => o.isOn);
  const hasOff = observations.some((o) => !o.isOn);
  if (!hasOn || !hasOff) return null;

  // Effect value nearest each observation time.
  const effAt = (t: number): number => {
    let best = sim[0];
    let bestDiff = Infinity;
    for (const pt of sim) {
      const diff = Math.abs(pt.tHours - t);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = pt;
      }
    }
    return best?.effect ?? 0;
  };
  const obs = observations.map((o) => ({ effect: effAt(o.tHours), isOn: o.isOn }));

  const maxEff = Math.max(...sim.map((p) => p.effect));
  const candidates: number[] = [];
  for (let i = 1; i < 200; i++) candidates.push((maxEff * i) / 200);

  let bestThreshold = candidates[0];
  let bestErrors = Infinity;
  for (const th of candidates) {
    let errors = 0;
    for (const o of obs) {
      const predOn = o.effect >= th;
      if (predOn !== o.isOn) errors++;
    }
    if (errors < bestErrors) {
      bestErrors = errors;
      bestThreshold = th;
    }
  }
  return round(bestThreshold);
}
