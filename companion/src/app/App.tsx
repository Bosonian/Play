import { useState } from 'react';
import { PatientRoot } from './screens/patient/PatientRoot';
import { DoctorGate } from './screens/DoctorGate';
import { DoctorHome } from './screens/DoctorHome';
import { SteadyRead } from './steady/SteadyRead';

type Mode = 'patient' | 'doctor';

export function App() {
  const [mode, setMode] = useState<Mode>('patient');

  // doctorUnlocked is React state only — it is NEVER written to storage.
  // Neither this nor `mode` above is persisted, so a reload always starts
  // fresh at mode='patient', doctorUnlocked=false: a reload deliberately
  // re-locks doctor mode and drops back to patient mode. This phone is the
  // patient's; doctor access must not survive a pocket reload.
  const [doctorUnlocked, setDoctorUnlocked] = useState(false);

  // Steady Read is a discreet secondary tool, not a third mode: it lives
  // outside the Patient/Doctor segmented group and the clinical logging
  // path entirely, reachable by a single quiet tap and just as easily left.
  const [showSteady, setShowSteady] = useState(false);

  return (
    <div className="mx-auto flex h-full max-w-md flex-col bg-bg pt-safe-top text-fg">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-title font-medium">Companion</span>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShowSteady(true)}
            className="text-label text-fg-muted underline underline-offset-2"
          >
            Steady Read
          </button>
          <div role="group" aria-label="Mode" className="flex overflow-hidden rounded-sm border border-line">
            <button
              type="button"
              aria-pressed={mode === 'patient'}
              // Returning to patient mode re-locks doctor mode: the doctor may be
              // handing the phone back, and unlocked access must not ride along.
              // (Only matters once doctor mode holds data; correct to enforce now.)
              onClick={() => {
                setMode('patient');
                setDoctorUnlocked(false);
              }}
              className={`px-3 py-1.5 text-label ${
                mode === 'patient' ? 'bg-accent text-white' : 'text-fg-muted'
              }`}
            >
              Patient
            </button>
            <button
              type="button"
              aria-pressed={mode === 'doctor'}
              onClick={() => setMode('doctor')}
              className={`px-3 py-1.5 text-label ${
                mode === 'doctor' ? 'bg-accent text-white' : 'text-fg-muted'
              }`}
            >
              Doctor
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 p-4">
        {showSteady && <SteadyRead onBack={() => setShowSteady(false)} />}
        {!showSteady && mode === 'patient' && <PatientRoot />}
        {!showSteady && mode === 'doctor' && !doctorUnlocked && (
          <DoctorGate onUnlock={() => setDoctorUnlocked(true)} onBack={() => setMode('patient')} />
        )}
        {!showSteady && mode === 'doctor' && doctorUnlocked && <DoctorHome />}
      </main>
    </div>
  );
}
