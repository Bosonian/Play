// Schematic cervical spinal-cord cross-section (design doc §6 — honest
// schematic: topologically correct and clickable, not a photoreal atlas plate).
//
// Layout in a 200×210 viewBox, dorsal (posterior) at TOP, ventral at BOTTOM:
//   - dorsal columns (gracile medial, cuneate lateral) across the top
//   - the gray-matter butterfly (dorsal horns, ventral horns, commissure)
//   - lateral corticospinal tract in the posterolateral funiculus
//   - lateral spinothalamic tract in the anterolateral funiculus
// Structures are bilateral; each hotspot groups both sides so tapping either
// selects the named structure. Hit shapes are ~30+ viewBox units ≈ >44px on a
// phone (design doc §8.6).

import type { KeyboardEvent, ReactNode } from 'react';
import type { DiagramProps, DiagramState } from './types';

type Base = 'gray' | 'white';

interface ShapeStyle {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  strokeDasharray?: string;
}

// Map a hotspot's state to fill/stroke. Idle gray matter shows gray; idle white
// matter shows a faint outline (visible enough to tap, unlabelled). Active
// states carry a stroke pattern too (highlight is dashed) so the diagram reads
// in greyscale — never colour alone.
function regionStyle(state: DiagramState, base: Base): ShapeStyle {
  if (state === 'idle') {
    return base === 'gray'
      ? { fill: 'var(--dia-gray)', fillOpacity: 1, stroke: 'var(--dia-stroke)', strokeWidth: 1, strokeOpacity: 0.6 }
      : { fill: 'var(--dia-stroke)', fillOpacity: 0, stroke: 'var(--dia-stroke)', strokeWidth: 1, strokeOpacity: 0.4 };
  }
  const table: Record<
    Exclude<DiagramState, 'idle'>,
    [string, number, string | undefined]
  > = {
    highlight: ['var(--dia-highlight)', 0.35, '4 3'],
    selected: ['var(--accent)', 0.45, undefined],
    correct: ['var(--correct)', 0.5, undefined],
    incorrect: ['var(--incorrect)', 0.5, undefined],
  };
  const [c, op, dash] = table[state];
  return { fill: c, fillOpacity: op, stroke: c, strokeWidth: 2.25, strokeOpacity: 1, strokeDasharray: dash };
}

// Mirror an x coordinate across the midline (x=100). Bilateral structures are
// authored once on the left and mirrored.
const mx = (x: number) => 200 - x;

function Region({
  id,
  label,
  base,
  states,
  onPick,
  children,
}: {
  id: string;
  label: string;
  base: Base;
  states: DiagramProps['states'];
  onPick: DiagramProps['onPick'];
  children: (style: ShapeStyle) => ReactNode;
}) {
  const state = states[id] ?? 'idle';
  const style = regionStyle(state, base);
  const interactive = onPick !== null;
  const activate = () => onPick?.(id);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  };
  return (
    <g
      role={interactive ? 'button' : 'img'}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      onClick={interactive ? activate : undefined}
      onKeyDown={interactive ? onKey : undefined}
      // pointer-events: all makes even fill-opacity-0 tract shapes capture taps
      // (so faint white-matter columns are reliably tappable), and confines the
      // hit area to the shapes themselves — not the group's bounding box, whose
      // centre for a bilateral structure is the empty midline.
      style={{
        cursor: interactive ? 'pointer' : 'default',
        pointerEvents: interactive ? 'all' : 'none',
      }}
    >
      {children(style)}
    </g>
  );
}

export function CordCervical({ states, onPick, title }: DiagramProps) {
  return (
    <svg
      viewBox="0 0 200 210"
      role="group"
      aria-label={title}
      className="h-full w-full"
      // Non-scaling strokes keep line weights constant regardless of render size.
      style={{ vectorEffect: 'non-scaling-stroke' }}
    >
      {/* Cord outline */}
      <ellipse
        cx="100"
        cy="105"
        rx="92"
        ry="82"
        fill="var(--surface)"
        stroke="var(--dia-stroke)"
        strokeWidth="1.5"
      />
      {/* Posterior median sulcus (top) + anterior median fissure (bottom) */}
      <line x1="100" y1="24" x2="100" y2="46" stroke="var(--dia-stroke)" strokeWidth="1" strokeOpacity="0.6" />
      <path d="M100 187 L96 150 L104 150 Z" fill="var(--dia-stroke)" fillOpacity="0.15" stroke="var(--dia-stroke)" strokeWidth="1" strokeOpacity="0.6" />

      {/* Gray commissure — static connector between the horns */}
      <rect x="86" y="99" width="28" height="10" rx="3" fill="var(--dia-gray)" stroke="var(--dia-stroke)" strokeWidth="1" strokeOpacity="0.6" />

      {/* Dorsal columns: gracile (medial) */}
      <Region id="gracile-fasciculus" label="Gracile fasciculus, medial dorsal column" base="white" states={states} onPick={onPick}>
        {(s) => (
          <>
            <rect x="90" y="46" width="9" height="26" rx="2" {...s} />
            <rect x={mx(99)} y="46" width="9" height="26" rx="2" {...s} />
          </>
        )}
      </Region>
      {/* Dorsal columns: cuneate (lateral) */}
      <Region id="cuneate-fasciculus" label="Cuneate fasciculus, lateral dorsal column" base="white" states={states} onPick={onPick}>
        {(s) => (
          <>
            <rect x="78" y="46" width="11" height="26" rx="2" {...s} />
            <rect x={mx(89)} y="46" width="11" height="26" rx="2" {...s} />
          </>
        )}
      </Region>

      {/* Dorsal (posterior) horns — gray */}
      <Region id="dorsal-horn" label="Dorsal horn, sensory gray matter" base="gray" states={states} onPick={onPick}>
        {(s) => (
          <>
            <polygon points="96,99 93,86 88,75 82,79 86,91 90,99" {...s} />
            <polygon points={`${mx(96)},99 ${mx(93)},86 ${mx(88)},75 ${mx(82)},79 ${mx(86)},91 ${mx(90)},99`} {...s} />
          </>
        )}
      </Region>

      {/* Ventral (anterior) horns — gray */}
      <Region id="ventral-horn" label="Ventral horn, motor gray matter" base="gray" states={states} onPick={onPick}>
        {(s) => (
          <>
            <polygon points="94,109 92,132 84,150 73,145 78,124 86,109" {...s} />
            <polygon points={`${mx(94)},109 ${mx(92)},132 ${mx(84)},150 ${mx(73)},145 ${mx(78)},124 ${mx(86)},109`} {...s} />
          </>
        )}
      </Region>

      {/* Central canal */}
      <Region id="central-canal" label="Central canal" base="white" states={states} onPick={onPick}>
        {(s) => <circle cx="100" cy="104" r="4" {...s} strokeWidth={Math.max(s.strokeWidth, 1)} />}
      </Region>

      {/* Lateral corticospinal tract — posterolateral funiculus */}
      <Region id="cst-lateral" label="Lateral corticospinal tract" base="white" states={states} onPick={onPick}>
        {(s) => (
          <>
            <ellipse cx="58" cy="106" rx="12" ry="15" {...s} />
            <ellipse cx={mx(58)} cy="106" rx="12" ry="15" {...s} />
          </>
        )}
      </Region>

      {/* Lateral spinothalamic tract — anterolateral funiculus */}
      <Region id="stt-lateral" label="Lateral spinothalamic tract" base="white" states={states} onPick={onPick}>
        {(s) => (
          <>
            <ellipse cx="62" cy="142" rx="11" ry="13" {...s} />
            <ellipse cx={mx(62)} cy="142" rx="11" ry="13" {...s} />
          </>
        )}
      </Region>
    </svg>
  );
}
