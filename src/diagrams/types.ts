// Shared contract for clickable cross-section diagrams. Each diagram is a
// schematic SVG whose named regions (hotspots) map to Structure ids. The Atlas
// mode drives the visual state; the diagram only knows how to draw itself and
// report which structure was tapped.
//
// Per-structure visual state (design doc §8.3.1 / §8.4): highlight = "find
// this" target (violet, dashed — a cue, not a judgement); selected = the user's
// current pick; correct/incorrect = the revealed answer. State is never colour
// alone — the diagram also uses stroke pattern, and Atlas surfaces text.

export type DiagramState =
  | 'idle'
  | 'highlight'
  | 'selected'
  | 'correct'
  | 'incorrect';

export interface DiagramProps {
  // structureId -> state. Absent ids render idle.
  states: Record<string, DiagramState>;
  // Called when a hotspot is activated (tap / Enter / Space). Null disables
  // interaction (e.g. during the reveal).
  onPick: ((structureId: string) => void) | null;
  // Accessible label for the whole figure.
  title: string;
}
