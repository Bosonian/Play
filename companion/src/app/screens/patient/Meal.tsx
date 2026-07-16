interface MealProps {
  onLog: (protein: 'low' | 'high') => void;
  onBack: () => void;
}

// Same slab styling/sizing/spacing as State.tsx (RESEARCH §1 wireframe
// groups Meal and State as the same slab-picker pattern).
const slabClass =
  'w-full rounded-md border border-line bg-surface px-4 py-6 min-h-[88px] text-left';

export function Meal({ onLog, onBack }: MealProps) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="self-start py-3 pr-3 text-label text-fg-muted underline underline-offset-2"
      >
        Back
      </button>
      <h1 className="text-title text-fg">Log a meal</h1>
      <div className="mt-8 space-y-8">
        <button type="button" onClick={() => onLog('low')} className={slabClass}>
          <span className="block text-title font-medium text-fg">Low protein</span>
          <span className="block text-body text-fg-muted">Little or no meat, fish, egg, or dairy</span>
        </button>
        <button type="button" onClick={() => onLog('high')} className={slabClass}>
          <span className="block text-title font-medium text-fg">High protein</span>
          <span className="block text-body text-fg-muted">Meat, fish, egg, or dairy</span>
        </button>
      </div>
    </div>
  );
}
