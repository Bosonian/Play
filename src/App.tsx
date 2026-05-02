import { Capture } from './Capture';
import { TodaysScene } from './TodaysScene';
import { WhatsBeenSitting } from './WhatsBeenSitting';

// Brief §4: single-screen, three sections stacked vertically.
// WhatsBeenSitting renders nothing when no qualifying tasks — the gap-12
// flex parent handles the absent-element case cleanly (no extra space).
export function App() {
  return (
    <main className="min-h-dvh max-w-xl mx-auto px-6 py-12 text-neutral-700">
      <div className="flex flex-col gap-12">
        <TodaysScene />
        <Capture />
        <WhatsBeenSitting />
      </div>
    </main>
  );
}
