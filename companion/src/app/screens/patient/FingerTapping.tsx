import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  TAPPING_FEATURE_VERSION,
  TAPPING_PROTOCOL_VERSION,
  type HandSide,
  type TapTarget,
  type TappingResult,
} from '../../../domain/tapping';
import {
  finishTappingAcquisition,
  interruptTappingAcquisition,
  recordTappingTouch,
  startTappingAcquisition,
  type TappingAcquisition,
  type TappingInterruptionReason,
} from '../../../domain/tappingAcquisition';
import {
  OBSERVATION_PROTOCOL_VERSION,
  type AssessmentReason,
  type AssessmentRecord,
  type ObservationStudy,
} from '../../../domain/observation';
import { db, putAssessments } from '../../db/store';
import { safeUuid } from '../../lib/uuid';
import { logEvent } from '../../activity/activityLog';

type HandResult = {
  side: HandSide;
  startedAt: string;
  completedAt: string;
  outcome: 'completed' | 'interrupted' | 'unable';
  result?: TappingResult;
  qualityReasons?: string[];
  metadata: {
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio: number;
    orientation: string;
  };
};

type SessionIdentity = {
  sessionId: string;
  assessmentIds: Record<HandSide, string>;
};

const REASONS: Array<{ value: AssessmentReason; label: string }> = [
  { value: 'pre-dose', label: 'Before a dose' },
  { value: 'expected-onset', label: 'After a dose' },
  { value: 'expected-wearing-off', label: 'Medicine wearing off' },
  { value: 'symptom-triggered', label: 'Symptoms changed' },
];

export function FingerTapping({
  study,
  onDone,
  onCancel,
}: {
  study: ObservationStudy;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<AssessmentReason | null>(null);
  const [side, setSide] = useState<HandSide | null>(null);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(10);
  const [expected, setExpected] = useState<TapTarget>('a');
  const [leftResult, setLeftResult] = useState<HandResult | null>(null);
  const [pendingRecords, setPendingRecords] = useState<AssessmentRecord[] | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const acquisitionRef = useRef<TappingAcquisition | null>(null);
  const runningRef = useRef(false);
  const startedAtRef = useRef('');
  const leftResultRef = useRef<HandResult | null>(null);
  const identityRef = useRef<SessionIdentity | null>(null);
  const activePointersRef = useRef(new Set<number>());
  const initializedRef = useRef(false);
  const resolvedSidesRef = useRef(new Set<HandSide>());
  const savingRef = useRef(false);
  const metadataRef = useRef<HandResult['metadata'] | null>(null);

  function readDisplayMetadata(): HandResult['metadata'] {
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      orientation: window.screen.orientation?.type
        ?? (window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'),
    };
  }

  function chooseReason(selected: AssessmentReason) {
    if (initializedRef.current) return;
    initializedRef.current = true;
    identityRef.current = {
      sessionId: safeUuid(),
      assessmentIds: { left: safeUuid(), right: safeUuid() },
    };
    setReason(selected);
    setSide('left');
  }

  function assessmentFor(run: HandResult): AssessmentRecord {
    const identity = identityRef.current;
    if (!identity || !reason) throw new Error('Tapping session is not initialized');
    return {
      id: identity.assessmentIds[run.side],
      studyId: study.id,
      patient: study.patient,
      protocolVersion: OBSERVATION_PROTOCOL_VERSION,
      kind: 'finger-tapping',
      reason,
      sessionId: identity.sessionId,
      outcome: run.outcome,
      measurementProtocolVersion: TAPPING_PROTOCOL_VERSION,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      quality: run.result?.quality ?? 'invalid',
      qualityReasons: run.result?.qualityReasons ?? run.qualityReasons ?? ['unable-to-complete'],
      metadata: { side: run.side, ...run.metadata },
      ...(run.result ? {
        featureSchemaVersion: TAPPING_FEATURE_VERSION,
        features: { ...run.result.features },
      } : {}),
    };
  }

  async function save(records: AssessmentRecord[]) {
    if (savingRef.current) return;
    savingRef.current = true;
    setPendingRecords(records);
    setSaveState('saving');
    try {
      await putAssessments(db, records);
      void logEvent('motor', `Completed bilateral tapping assessment: ${reason}`);
      onDone();
    } catch {
      setSaveState('error');
    } finally {
      savingRef.current = false;
    }
  }

  function acceptHandResult(run: HandResult) {
    if (run.side === 'left') {
      leftResultRef.current = run;
      setLeftResult(run);
      setSide('right');
      return;
    }

    const left = leftResultRef.current;
    if (!left) {
      setSaveState('error');
      return;
    }
    void save([assessmentFor(left), assessmentFor(run)]);
  }

  function finishCurrent(interruption?: TappingInterruptionReason) {
    if (!runningRef.current) return;
    const acquisition = acquisitionRef.current;
    if (!acquisition) return;
    const now = performance.now();
    if (interruption) interruptTappingAcquisition(acquisition, interruption, now);
    const finished = finishTappingAcquisition(acquisition, now);
    if (!finished) return;

    runningRef.current = false;
    if (resolvedSidesRef.current.has(acquisition.side)) return;
    resolvedSidesRef.current.add(acquisition.side);
    acquisitionRef.current = null;
    activePointersRef.current.clear();
    setRunning(false);
    acceptHandResult({
      side: acquisition.side,
      startedAt: startedAtRef.current,
      completedAt: new Date().toISOString(),
      outcome: finished.outcome,
      result: finished.result,
      metadata: metadataRef.current ?? readDisplayMetadata(),
    });
  }

  useEffect(() => {
    if (!running) return;
    const countdown = window.setInterval(() => {
      const acquisition = acquisitionRef.current;
      if (!acquisition) return;
      const elapsed = acquisition.deadlineMs - performance.now();
      setRemaining(Math.max(0, Math.ceil(elapsed / 1000)));
    }, 100);
    let timeout = 0;
    const scheduleFinish = () => {
      const acquisition = acquisitionRef.current;
      if (!acquisition) return;
      timeout = window.setTimeout(() => {
        if (performance.now() < acquisition.deadlineMs) {
          scheduleFinish();
        } else {
          finishCurrent();
        }
      }, Math.max(0, acquisition.deadlineMs - performance.now()));
    };
    scheduleFinish();
    return () => {
      window.clearInterval(countdown);
      window.clearTimeout(timeout);
    };
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') finishCurrent('page-hidden');
    };
    const pageHidden = () => finishCurrent('pagehide');
    const layoutChanged = () => finishCurrent('layout-changed');
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pagehide', pageHidden);
    window.addEventListener('resize', layoutChanged);
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('pagehide', pageHidden);
      window.removeEventListener('resize', layoutChanged);
    };
  }, [running]);

  function start(hand: HandSide) {
    if (runningRef.current || resolvedSidesRef.current.has(hand) || savingRef.current) return;
    const now = performance.now();
    const acquisition = startTappingAcquisition(hand, now);
    acquisitionRef.current = acquisition;
    startedAtRef.current = new Date().toISOString();
    metadataRef.current = readDisplayMetadata();
    activePointersRef.current.clear();
    runningRef.current = true;
    setExpected(acquisition.expectedTarget);
    setRemaining(10);
    setSide(hand);
    setRunning(true);
  }

  function unable(hand: HandSide) {
    if (runningRef.current || resolvedSidesRef.current.has(hand) || savingRef.current) return;
    resolvedSidesRef.current.add(hand);
    const now = new Date().toISOString();
    acceptHandResult({
      side: hand,
      startedAt: now,
      completedAt: now,
      outcome: 'unable',
      metadata: readDisplayMetadata(),
    });
  }

  function stopBeforeHand(hand: HandSide) {
    if (runningRef.current || resolvedSidesRef.current.has(hand) || savingRef.current) return;
    resolvedSidesRef.current.add(hand);
    const now = new Date().toISOString();
    acceptHandResult({
      side: hand,
      startedAt: now,
      completedAt: now,
      outcome: 'interrupted',
      qualityReasons: ['user-stopped-before-hand'],
      metadata: readDisplayMetadata(),
    });
  }

  function capture(event: PointerEvent<HTMLDivElement>) {
    const acquisition = acquisitionRef.current;
    if (!runningRef.current || !acquisition) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    activePointersRef.current.add(event.pointerId);
    event.currentTarget.setPointerCapture(event.pointerId);
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tap-target]');
    const actualTarget = (target?.dataset.tapTarget as TapTarget | undefined) ?? 'outside';
    const captureResult = recordTappingTouch(acquisition, {
      atMs: performance.now(),
      x: event.clientX,
      y: event.clientY,
      actualTarget,
      pointerCount: event.isPrimary ? activePointersRef.current.size : 2,
    });
    if (captureResult === 'interrupted') {
      finishCurrent('multiple-pointers');
    } else if (captureResult === 'recorded') {
      setExpected(acquisition.expectedTarget);
    }
  }

  function releasePointer(event: PointerEvent<HTMLDivElement>) {
    activePointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  if (!reason) {
    return (
      <div>
        <button type="button" onClick={onCancel}
          className="text-label text-fg-muted underline underline-offset-2">Cancel</button>
        <h1 className="mt-6 text-title font-medium text-fg">Why are you checking now?</h1>
        <div className="mt-6 space-y-4">
          {REASONS.map((item) => (
            <button key={item.value} type="button" onClick={() => chooseReason(item.value)}
              className="min-h-[76px] w-full rounded-md border border-line bg-surface text-body-lg text-fg">
              {item.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (saveState === 'saving') {
    return <p className="text-body text-fg" role="status">Saving both hand results…</p>;
  }

  if (saveState === 'error') {
    return (
      <div role="alert" className="rounded-md border border-line bg-surface p-4">
        <p className="text-body text-warn">Couldn’t save both hand results. Your results are still here.</p>
        <button type="button" disabled={!pendingRecords}
          onClick={() => pendingRecords && void save(pendingRecords)}
          className="mt-4 min-h-[56px] w-full rounded-md bg-accent text-body-lg text-white disabled:opacity-40">
          Retry save
        </button>
      </div>
    );
  }

  if (!running) {
    const currentSide = side ?? 'left';
    return (
      <div>
        <button type="button" onClick={() => leftResult ? stopBeforeHand(currentSide) : onCancel()}
          className="text-label text-fg-muted underline underline-offset-2">
          {leftResult ? 'Stop and save' : 'Cancel'}
        </button>
        <h1 className="mt-6 text-title font-medium capitalize text-fg">{currentSide} hand</h1>
        <p className="mt-3 text-body text-fg-muted">
          Use only your {currentSide} index finger. Tap the two targets alternately as quickly and accurately as you can.
        </p>
        {leftResult?.outcome === 'interrupted' && currentSide === 'right' && (
          <p className="mt-3 text-body text-warn">The left-hand test was interrupted. Its partial record will be saved.</p>
        )}
        <button type="button" onClick={() => start(currentSide)}
          className="mt-8 min-h-[88px] w-full rounded-md bg-accent text-title font-medium text-white">
          Start 10-second test
        </button>
        <button type="button" onClick={() => unable(currentSide)}
          className="mt-4 min-h-[56px] w-full text-body text-fg-muted underline underline-offset-2">
          Unable to complete with this hand
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-title font-medium capitalize text-fg">{side} hand</h1>
        <span className="text-title tabular-nums text-fg">{remaining}</span>
      </div>
      <p className="mt-2 text-body text-fg-muted">Alternate between the highlighted targets.</p>
      <div className="mt-6 grid min-h-[360px] touch-none grid-cols-2 gap-6 rounded-md bg-surface-soft p-5"
        onPointerDown={capture} onPointerUp={releasePointer} onPointerCancel={releasePointer}>
        {(['a', 'b'] as TapTarget[]).map((target) => (
          <button key={target} type="button" data-tap-target={target}
            className={`touch-none rounded-full border-4 ${
              expected === target ? 'border-accent bg-accent' : 'border-line bg-surface'
            }`}
            aria-label={`Tap target ${target}`} />
        ))}
      </div>
    </div>
  );
}
