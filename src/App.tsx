import { Capture } from './Capture';
import { TodaysScene } from './TodaysScene';

// Brief §4: single-screen layout, three sections stacked vertically.
// Today's Scene at top, Capture in middle, "What's been sitting" (step 5)
// at the bottom once it lands.
export function App() {
  return (
    <main className="min-h-dvh max-w-xl mx-auto px-6 py-12 text-neutral-700">
      <div className="flex flex-col gap-12">
        <TodaysScene />
        <Capture />
      </div>
    </main>
  );
}
