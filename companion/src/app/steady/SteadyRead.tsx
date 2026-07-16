import { useEffect, useRef, useState } from 'react';
import { Stabilizer, type StabilizerConfig } from './stabilizer';
import { useDeviceMotion } from './useDeviceMotion';

interface SteadyReadProps {
  onBack: () => void;
}

const DEFAULT_CUTOFF_HZ = 0.8;
const CUTOFF_RANGE: [number, number] = [0.3, 2.0];

const DEFAULT_STRENGTH = 3000;
const STRENGTH_RANGE: [number, number] = [0, 6000];

const DEFAULT_ZOOM = 1.15;
const ZOOM_RANGE: [number, number] = [1.0, 1.4];

// Short, original, calm prose — deliberately non-clinical and free of
// exclamation points (CLAUDE.md tone rules), and deliberately NOT a
// copyrighted passage: this exists only to give the stabilizer something
// of realistic reading length to hold steady.
const SAMPLE_PARAGRAPHS = [
  'The garden settles into itself by late afternoon. Shadows lengthen across the gravel path, and the wind that moved through the birch trees at midday has quieted to something you would have to watch closely to notice at all.',
  'A kettle left too long on a low flame will still find its way to a boil, patient about it, in no particular hurry. Steam rises in a thin column before the draft from the window catches it and thins it to nothing a few centimetres above the spout.',
  'Somewhere in the building a door closes, not loudly, and the sound carries down the corridor the way sound does in old buildings with high ceilings and little furniture to absorb it. Then it is quiet again.',
  'This page holds still while you read it. The words do not move, the line you are on stays the line you are on, and there is nothing here that asks you to hurry to the next sentence before you are ready for it.',
];

// Computes the shared clamp for both axes from how much the zoomed content
// overhangs the visible container on each side. A single Stabilizer
// instance clamps X and Y with one maxOffsetPx, so we take the smaller of
// the two axis overscans — the safe choice, since using the larger one
// could let the content's edge show on the tighter axis.
function computeMaxOffsetPx(container: HTMLElement, zoom: number): number {
  const { width, height } = container.getBoundingClientRect();
  const widthOverscan = (width * (zoom - 1)) / 2;
  const heightOverscan = (height * (zoom - 1)) / 2;
  return Math.max(0, Math.min(widthOverscan, heightOverscan));
}

export function SteadyRead({ onBack }: SteadyReadProps) {
  // prefers-reduced-motion: reduce → stabilization defaults off and we show
  // the note below. Read once at mount; this device setting doesn't change
  // while the screen is open in any way we need to react to live.
  const [reducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );

  const [stabilizationOn, setStabilizationOn] = useState(!reducedMotion);
  // Becomes true the moment Begin is tapped (whether the permission prompt
  // ends up granted, denied, or absent) — this is the `active` flag for the
  // motion hook, so Back/unmount reliably tears the listener down even if
  // permission was never granted (SPEC named edge case: no leaked loop).
  const [began, setBegan] = useState(false);

  const [cutoffHz, setCutoffHz] = useState(DEFAULT_CUTOFF_HZ);
  const [strengthPxPerRad, setStrengthPxPerRad] = useState(DEFAULT_STRENGTH);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  const motion = useDeviceMotion(began);

  // maxOffsetPx starts generous and is corrected to the real container size
  // as soon as it's measured (effect below) — never left un-clamped.
  const stabilizerRef = useRef(new Stabilizer({ cutoffHz, strengthPxPerRad, maxOffsetPx: 0 }));
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // Push slider changes into the stabilizer's live config. Cheap and
  // infrequent (user-driven, not per-frame), so plain React state → effect
  // is fine here — this is not the rAF hot path.
  useEffect(() => {
    const cfg: Partial<StabilizerConfig> = { cutoffHz, strengthPxPerRad };
    stabilizerRef.current.setConfig(cfg);
  }, [cutoffHz, strengthPxPerRad]);

  // Recompute the overscan-derived clamp whenever zoom (or the container)
  // changes, so the clamp always matches what's actually available to shift
  // into without exposing the content's edge.
  useEffect(() => {
    const container = outerRef.current;
    if (!container) return;
    const maxOffsetPx = computeMaxOffsetPx(container, zoom);
    stabilizerRef.current.setConfig({ maxOffsetPx });
  }, [zoom]);

  // The stabilization loop. Runs only while the toggle is on AND motion is
  // actually running; otherwise it writes a single identity-plus-zoom
  // transform and stops — never leaves a stale offset behind (SPEC named
  // edge case). Per SPEC RISK 2: this writes directly to element.style
  // inside requestAnimationFrame and never touches React state, which is
  // what keeps the counter-shift on the compositor thread instead of being
  // gated behind a React render each frame.
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;

    const active = stabilizationOn && motion.status === 'running';
    if (!active) {
      stabilizerRef.current.reset();
      inner.style.willChange = 'transform';
      inner.style.transformOrigin = 'center';
      inner.style.transform = `scale(${zoom})`;
      return;
    }

    let rafId: number;
    const loop = () => {
      const sample = motion.latestRef.current;
      if (sample) {
        const t = stabilizerRef.current.update(sample);
        inner.style.willChange = 'transform';
        inner.style.transformOrigin = 'center';
        inner.style.transform = `translate3d(${t.xPx}px, ${t.yPx}px, 0) rotate(${t.rollDeg}deg) scale(${zoom})`;
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [stabilizationOn, motion.status, zoom]);

  const showGate = motion.status !== 'running';

  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-title font-medium">Steady Read</h1>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 text-label text-fg-muted underline underline-offset-2"
        >
          Back
        </button>
      </div>

      <p className="mt-2 text-body text-fg-muted">
        Reduces the apparent shake of this screen's content using the phone's motion sensor. It
        steadies only what this app shows, not other apps.
      </p>

      {/* Always visible regardless of gate/running state — this is the
          safety control: lagged or imperfect counter-motion can be
          uncomfortable, so turning it off must never be more than one tap
          away. State is shown by colour AND text, never colour alone. */}
      <div className="mt-4 flex items-center justify-between gap-4 rounded-md border border-line bg-bg p-3">
        <span className="text-label text-fg">Stabilization</span>
        <button
          type="button"
          aria-pressed={stabilizationOn}
          onClick={() => setStabilizationOn((on) => !on)}
          className={`min-h-[76px] min-w-[76px] rounded-md px-4 text-label font-medium ${
            stabilizationOn ? 'bg-accent text-white' : 'border border-line text-fg-muted'
          }`}
        >
          {stabilizationOn ? 'On' : 'Off'}
        </button>
      </div>

      {reducedMotion && (
        <p className="mt-2 text-caption text-fg-muted">
          Reduced motion is on for this device. Stabilization starts off. Turn it on if you want
          it.
        </p>
      )}

      {showGate && (
        <div className="mt-4 rounded-md border border-line bg-bg p-3">
          {motion.status === 'unavailable' ? (
            <p className="text-label text-warn">
              This device does not report motion to the browser. Steady Read cannot run here.
            </p>
          ) : (
            <>
              <h2 className="text-label font-medium text-fg">Steady Read needs motion access</h2>
              <p className="mt-1 text-label text-fg-muted">
                Steady Read uses the phone's motion sensor to counter shake. Motion data stays on
                this device and is not stored.
              </p>
              {motion.status === 'denied' && (
                <p className="mt-2 text-label text-warn">
                  Motion access was not granted. Steady Read cannot run without it.
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  setBegan(true);
                  void motion.requestAndStart();
                }}
                className="mt-3 min-h-[76px] w-full rounded-md bg-accent px-4 text-label font-medium text-white"
              >
                Begin
              </button>
            </>
          )}
        </div>
      )}

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="text-label text-fg-muted">Strength</span>
          <input
            type="range"
            min={STRENGTH_RANGE[0]}
            max={STRENGTH_RANGE[1]}
            step={100}
            value={strengthPxPerRad}
            onChange={(e) => setStrengthPxPerRad(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>

        <label className="block">
          <span className="text-label text-fg-muted">Zoom</span>
          <input
            type="range"
            min={ZOOM_RANGE[0]}
            max={ZOOM_RANGE[1]}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>

        <label className="block">
          <span className="text-label text-fg-muted">Cutoff (Hz)</span>
          <input
            type="range"
            min={CUTOFF_RANGE[0]}
            max={CUTOFF_RANGE[1]}
            step={0.1}
            value={cutoffHz}
            onChange={(e) => setCutoffHz(Number(e.target.value))}
            className="mt-1 w-full"
          />
          <span className="mt-1 block text-caption text-fg-muted">
            Higher cutoff follows deliberate movement more. Lower cutoff holds steadier.
          </span>
        </label>
      </div>

      <div ref={outerRef} className="mt-4 h-64 overflow-hidden rounded-md border border-line bg-bg">
        <div ref={innerRef} className="p-4">
          {SAMPLE_PARAGRAPHS.map((paragraph) => (
            <p key={paragraph.slice(0, 24)} className="mb-3 text-body-lg text-fg last:mb-0">
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
