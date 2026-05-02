import { TodaysScene } from './TodaysScene';

// Single-screen app per brief §4. Capture (step 4) and What's been sitting
// (step 5) will stack below TodaysScene as they get implemented.
export function App() {
  return (
    <main className="min-h-dvh max-w-xl mx-auto px-6 py-12 text-neutral-700">
      <TodaysScene />
    </main>
  );
}
