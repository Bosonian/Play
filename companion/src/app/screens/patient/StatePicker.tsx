import { useState } from 'react';
import {
  mapPatientTap,
  PRIMARY_TAP_OPTIONS,
  type DyskinesiaRefinement,
  type MotorState,
  type PrimaryTap,
} from '../../../domain/motor';

export interface StateSelection {
  primary: PrimaryTap;
  refinement?: DyskinesiaRefinement;
  state: MotorState;
  reportedAt: string;
}

const slabClass = 'w-full rounded-md border border-line bg-surface px-4 py-6 min-h-[88px] text-left';

export function StatePicker({
  title = 'How I feel now',
  onComplete,
  onCancel,
}: {
  title?: string;
  onComplete: (selection: StateSelection) => void;
  onCancel: () => void;
}) {
  const [dyskinesiaAt, setDyskinesiaAt] = useState<string | null>(null);

  function complete(primary: PrimaryTap, refinement?: DyskinesiaRefinement, at = new Date().toISOString()) {
    onComplete({ primary, refinement, state: mapPatientTap(primary, refinement), reportedAt: at });
  }

  if (dyskinesiaAt) {
    return (
      <div>
        <button type="button" onClick={() => setDyskinesiaAt(null)}
          className="text-label text-fg-muted underline underline-offset-2">Change state</button>
        <h2 className="mt-6 text-title text-fg">Was the dyskinesia troublesome?</h2>
        <p className="mt-1 text-body text-fg-muted">Optional. Skip records dyskinesia without a refinement.</p>
        <div className="mt-6 space-y-4">
          <button type="button" className={slabClass}
            onClick={() => complete('on-dyskinesia', 'troublesome', dyskinesiaAt)}>Yes</button>
          <button type="button" className={slabClass}
            onClick={() => complete('on-dyskinesia', 'nontroublesome', dyskinesiaAt)}>No</button>
          <button type="button" className={slabClass}
            onClick={() => complete('on-dyskinesia', undefined, dyskinesiaAt)}>Skip</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={onCancel}
        className="text-label text-fg-muted underline underline-offset-2">Back</button>
      <h1 className="mt-6 text-title text-fg">{title}</h1>
      <div className="mt-8 space-y-4">
        {PRIMARY_TAP_OPTIONS.map((option) => (
          <button key={option.value} type="button" className={slabClass} onClick={() => {
            const at = new Date().toISOString();
            if (option.value === 'on-dyskinesia') setDyskinesiaAt(at);
            else complete(option.value, undefined, at);
          }}>
            <span className="block text-title font-medium text-fg">{option.label}</span>
            <span className="block text-body text-fg-muted">{option.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
