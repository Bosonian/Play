import type { ReframeMode } from '../db/types';

interface ReframePattern {
  // Lowercased keywords matched as substrings against the lowercased task title.
  // Match if ANY keyword appears.
  keywords: readonly string[];
  templates: Record<ReframeMode, string>;
}

// Order matters: first matching pattern wins. Put more specific patterns first
// if they would otherwise be subsumed by a broader one. Verbatim from brief §7.3.
const PATTERNS: readonly ReframePattern[] = [
  {
    keywords: ['email', 'reply', 'respond', 'message'],
    templates: {
      joker:
        'Write the first draft as if you were explaining it to your sister, in Malayalam, in the kitchen.',
      kinesthete:
        'Stand up. Walk to the balcony. Dictate the reply pacing back and forth.',
      ninety_second:
        'Open the draft. Write only the greeting and one sentence. Stop after 90 seconds even if mid-sentence.',
    },
  },
  {
    keywords: ['read', 'review', 'study', 'facharzt', 'anatomy', 'guideline'],
    templates: {
      joker:
        'Read it out loud in the most ridiculous accent you can sustain. The sillier, the more memorable.',
      kinesthete: 'Print one page. Take it to a different room. Read it standing up.',
      ninety_second:
        "Open the document. Read one paragraph. Close it. That's the whole task.",
    },
  },
  {
    keywords: ['clean', 'tidy', 'organize', 'file', 'sort', 'submit', 'form'],
    templates: {
      joker:
        "Put on a song you'd never admit to liking. Do this for one song's length.",
      kinesthete: 'Set a timer for 4 minutes and move continuously the whole time.',
      ninety_second: 'Do exactly one piece of this. The smallest piece. Stop after.',
    },
  },
  {
    keywords: ['write', 'draft', 'prepare', 'plan'],
    templates: {
      joker:
        "Dictate it badly. Use Wispr Flow. Don't correct anything. The errors are features.",
      kinesthete:
        "Walk while dictating. Don't sit down until the first paragraph exists.",
      ninety_second:
        "Open a blank document. Type the first sentence. That's the task.",
    },
  },
];

const GENERIC_FALLBACK: Record<ReframeMode, string> = {
  joker:
    'Approach this task as if you were narrating it to someone who finds it ridiculous.',
  kinesthete: 'Stand up. Move to a different room. Do this task there.',
  ninety_second:
    'Set a timer for 90 seconds. Do as much as you can. Stop when it rings, even mid-sentence.',
};

// Returns one suggestion per mode for the given task title. The user picks
// which mode to apply (per brief §5.3 — equal visual weight, not auto-selected).
export function getReframesFor(taskTitle: string): Record<ReframeMode, string> {
  const lower = taskTitle.toLowerCase();
  const match = PATTERNS.find((pattern) =>
    pattern.keywords.some((kw) => lower.includes(kw)),
  );
  return match ? match.templates : GENERIC_FALLBACK;
}
