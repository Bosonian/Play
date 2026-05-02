import { dropTask, reframeTask } from './db/task';
import { getReframesFor } from './reframe/templates';
import type { ReframeMode, Task } from './db/types';

interface Props {
  task: Task;
  onChose: () => void;
  onDropped: () => void;
}

// Labels verbatim from brief §5.3.
const MODES: ReadonlyArray<{ mode: ReframeMode; label: string; sub: string }> = [
  {
    mode: 'joker',
    label: 'Make it silly',
    sub: 'Joker mode — strip dignity from the task',
  },
  {
    mode: 'kinesthete',
    label: 'Make it embodied',
    sub: 'Kinesthete mode — change the body, change the brain',
  },
  {
    mode: 'ninety_second',
    label: 'Make it tiny',
    sub: '90-second mode — lower the activation barrier',
  },
];

// Brief §5.3: four options of EQUAL visual weight. Drop is a peer to the
// reframe modes, not an afterthought — a task sitting 3+ days is sometimes
// a signal that it shouldn't be done at all, and the UI must make releasing
// it as easy as reframing it. Same button structure, three lines per option,
// same hover treatment.
//
// The ▸ arrows are the one place clay-accent color shows up consistently —
// gives a small warm pulse to the option list without affecting readability.
export function ReframeFlow({ task, onChose, onDropped }: Props) {
  const reframes = getReframesFor(task.title);

  return (
    <section className="flex flex-col gap-5">
      <p className="text-base text-ink">
        <span className="text-ink-mute">You&apos;ve been avoiding: </span>
        <span className="font-medium">{task.title}</span>
      </p>
      <p className="text-sm text-ink-mute">What now?</p>
      <ul className="flex flex-col gap-5">
        {MODES.map(({ mode, label, sub }) => (
          <li key={mode}>
            <button
              type="button"
              onClick={async () => {
                await reframeTask(task.id, reframes[mode], mode);
                onChose();
              }}
              className="w-full flex flex-col items-start gap-1 text-left text-ink-soft hover:text-ink"
            >
              <span className="text-base font-medium text-ink">
                <span className="text-clay">▸</span> {label}
              </span>
              <span className="text-xs italic text-ink-mute">{sub}</span>
              <span className="text-sm text-ink-soft">{reframes[mode]}</span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={async () => {
              await dropTask(task.id);
              onDropped();
            }}
            className="w-full flex flex-col items-start gap-1 text-left text-ink-soft hover:text-ink"
          >
            <span className="text-base font-medium text-ink">
              <span className="text-clay">▸</span> Drop it
            </span>
            <span className="text-xs italic text-ink-mute">
              release mode — some things don&apos;t need doing
            </span>
            <span className="text-sm text-ink-soft">
              Marks the task abandoned. No questions asked.
            </span>
          </button>
        </li>
      </ul>
    </section>
  );
}
