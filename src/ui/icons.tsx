// Small inline stroke icons. Inline (not an icon font/library) to stay offline,
// dependency-free, and to inherit `currentColor` so they theme automatically.
// 24×24, 1.75 stroke, rounded — calm and legible at nav size.

type IconProps = { className?: string };

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

// Map: a travelled path with stations — the journey up the neuraxis.
export function MapIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 21c0-3-4-5-4-9a4 4 0 0 1 8 0c0 4-4 6-4 9Z" />
      <circle cx="12" cy="12" r="1.4" />
      <path d="M12 3v2" />
    </svg>
  );
}

// Today: a check inside a ring — the daily review, done.
export function TodayIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  );
}

// Stats: rising bars — mastery over time.
export function StatsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 19V11M12 19V6M19 19v-5" />
      <path d="M4 21h16" />
    </svg>
  );
}

// More: horizontal dots — settings and the rest.
export function MoreIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18" cy="12" r="1.2" />
    </svg>
  );
}

// Lock glyph for locked map nodes.
export function LockIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

// Arrow for the CTA pill and ▸ affordances.
export function ArrowIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
