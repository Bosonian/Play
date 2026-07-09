import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { StepTemplate, Template } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';

interface TemplateEditProps {
  id?: string;
  onNavigate: (screen: Screen) => void;
}

const BLANK: Omit<Template, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  destination: '',
  travelMinutes: 20,
  bufferMinutes: 10,
  steps: [],
};

export function TemplateEdit({ id, onNavigate }: TemplateEditProps) {
  // Loads once per `id`; existing is undefined while loading, null if the
  // id doesn't resolve to anything (shouldn't normally happen from Home's
  // own links, but guards against a stale reference).
  const existing = useLiveQuery(() => (id ? db.templates.get(id) : undefined), [id]);

  const [name, setName] = useState(BLANK.name);
  const [destination, setDestination] = useState(BLANK.destination);
  const [travelMinutes, setTravelMinutes] = useState(BLANK.travelMinutes);
  const [bufferMinutes, setBufferMinutes] = useState(BLANK.bufferMinutes);
  const [steps, setSteps] = useState<StepTemplate[]>(BLANK.steps);

  // Populate the form once the existing template has loaded. Runs only
  // when `existing` changes identity (i.e. once, on load) rather than on
  // every render, so typing in the form afterwards doesn't get clobbered.
  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setDestination(existing.destination);
      setTravelMinutes(existing.travelMinutes);
      setBufferMinutes(existing.bufferMinutes);
      setSteps(existing.steps);
    }
  }, [existing]);

  function addStep() {
    setSteps((prev) => [...prev, { id: crypto.randomUUID(), name: '', minutes: 5 }]);
  }

  function removeStep(stepId: string) {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
  }

  function updateStep(stepId: string, patch: Partial<StepTemplate>) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  }

  function moveStep(stepId: string, direction: -1 | 1) {
    setSteps((prev) => {
      const index = prev.findIndex((s) => s.id === stepId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const canSave = name.trim().length > 0 && travelMinutes >= 0 && bufferMinutes >= 0;

  async function handleSave() {
    if (!canSave) return;
    const now = new Date().toISOString();
    if (id && existing) {
      await db.templates.update(id, {
        name: name.trim(),
        destination: destination.trim(),
        travelMinutes,
        bufferMinutes,
        steps,
        updatedAt: now,
      });
    } else {
      await db.templates.add({
        id: crypto.randomUUID(),
        name: name.trim(),
        destination: destination.trim(),
        travelMinutes,
        bufferMinutes,
        steps,
        createdAt: now,
        updatedAt: now,
      });
    }
    onNavigate({ name: 'home' });
  }

  async function handleDelete() {
    if (!id) return;
    // A native confirm() is a deliberate shortcut for increment 1 — it's
    // the one destructive action on this screen and doesn't warrant a
    // custom dialog component yet. Revisit if more destructive actions
    // show up later and the jarring native styling starts to stand out.
    if (window.confirm(`Delete template "${name}"? This cannot be undone.`)) {
      await db.templates.delete(id);
      onNavigate({ name: 'home' });
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader
          title={id ? 'Edit template' : 'New template'}
          onBack={() => onNavigate({ name: 'home' })}
        />
      </div>

      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Klinik"
        enterKeyHint="next"
      />

      <TextField
        label="Destination"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
        placeholder="e.g. Klinikum Stuttgart"
        hint="Where you're going. Used for the Maps link on the Runway screen."
        enterKeyHint="next"
      />

      <NumberField
        label="Travel minutes"
        hint="From a quick look at Maps. This won't auto-update with live traffic."
        value={travelMinutes}
        onChange={setTravelMinutes}
      />

      <NumberField
        label="Friction buffer"
        hint="Keys, toilet, one more thing."
        value={bufferMinutes}
        onChange={setBufferMinutes}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Steps</h2>

        <div className="flex flex-col gap-2">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 p-2">
              <div className="flex flex-col">
                <button
                  onClick={() => moveStep(step.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${step.name || 'step'} up`}
                  className="flex h-5 w-8 items-center justify-center text-slate-500 hover:text-slate-200 disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  onClick={() => moveStep(step.id, 1)}
                  disabled={index === steps.length - 1}
                  aria-label={`Move ${step.name || 'step'} down`}
                  className="flex h-5 w-8 items-center justify-center text-slate-500 hover:text-slate-200 disabled:opacity-30"
                >
                  ▼
                </button>
              </div>

              <input
                value={step.name}
                onChange={(e) => updateStep(step.id, { name: e.target.value })}
                placeholder="Step name"
                aria-label="Step name"
                className="min-h-11 flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
              />

              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={step.minutes}
                aria-label={`${step.name || 'Step'} minutes`}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  updateStep(step.id, { minutes: Number.isNaN(parsed) ? 0 : parsed });
                }}
                className="min-h-11 w-16 rounded-md border border-slate-800 bg-slate-950 px-2 py-2 text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
              />

              <button
                onClick={() => removeStep(step.id)}
                aria-label={`Remove ${step.name || 'step'}`}
                className="flex min-h-11 min-w-11 items-center justify-center text-slate-500 hover:text-red-400"
              >
                &times;
              </button>
            </div>
          ))}
        </div>

        <Button variant="secondary" onClick={addStep}>
          Add step
        </Button>
      </section>

      <div className="mt-4 flex flex-col gap-3">
        <Button onClick={handleSave} disabled={!canSave}>
          Save template
        </Button>
        {id && (
          <Button variant="danger" onClick={handleDelete}>
            Delete template
          </Button>
        )}
      </div>
    </div>
  );
}
