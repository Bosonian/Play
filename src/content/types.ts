// The neuroanatomy content model — the crown jewels (design doc §0).
//
// Every game mode reads these types. Author the anatomy once, correctly, and
// Atlas / Drill / Cases / Ride-the-Tract / Time Attack are all just different
// questions asked of the same records. Because of that, these types are
// deliberately strict: a half-authored record (a tract with no decussation
// level, a syndrome pointing at a nonexistent tract) should fail to compile or
// fail Zod validation, never ship silently wrong.
//
// Zod schemas that mirror these types live in ./schema.ts and are the runtime
// guard. Keep the two in sync — the schemas are the source of truth at runtime,
// these types are the source of truth at author-time.

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

// All human-facing strings are localizable. `en` is required (v1 is English);
// `de` is optional so a German toggle is a later feature, not a rebuild
// (design doc §12). Storing this shape now costs almost nothing; retrofitting
// it later would touch every record.
export interface LocalizedString {
  en: string;
  de?: string;
}

// Authored-but-unverified vs expert-checked. Anything the author isn't fully
// certain of ships as 'draft' and is surfaced in the ContentReview screen for
// the domain expert to verify or correct (design doc §10).
export type ReviewStatus = 'draft' | 'verified';

// Points on the neuraxis, ordered caudal → rostral. This ordering is
// load-bearing: the journey map draws the spine bottom-up in this order, and
// Cases uses it for the "level" axis of a localization answer.
export const NEURAXIS_LEVELS = [
  'periphery',
  'cord',
  'medulla',
  'pons',
  'midbrain',
  'cerebellum',
  'thalamus',
  'hypothalamus',
  'basal-ganglia',
  'internal-capsule',
  'cortex',
] as const;
export type NeuraxisLevel = (typeof NEURAXIS_LEVELS)[number];

export type Side = 'left' | 'right' | 'midline';

// A reference to another content record by id. Aliased for readability so a
// field like `supplies: StructureRef[]` reads as intent, not just `string[]`.
export type StructureRef = string;
export type TractRef = string;

// Fields shared by every authored record: identity + provenance/accuracy.
interface ContentBase {
  id: string;
  reviewStatus: ReviewStatus;
  // Set when a fact is genuinely variable/level-of-detail-dependent (variant
  // vascular supply, exact laminar destinations). Contested facts are excluded
  // from Time Attack — you can't demand a fast single answer to an "it depends"
  // (design doc §6 / §10).
  contested?: boolean;
  // Free-text authoring note: a caveat, a source, a "verify this" flag.
  note?: string;
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

export type StructureType =
  | 'nucleus'
  | 'deep-nucleus'
  | 'tract-column' // a white-matter column as seen on a cross-section
  | 'gray-region' // horn, lamina group, reticular formation
  | 'gyrus'
  | 'cortical-area'
  | 'ventricle'
  | 'vascular'
  | 'nerve'
  | 'region'; // catch-all for a named territory (e.g. tegmentum)

export interface Structure extends ContentBase {
  name: LocalizedString;
  aliases?: string[]; // alternative names accepted by typed-answer matching
  level: NeuraxisLevel;
  type: StructureType;
  function: LocalizedString;
  clinicalNote?: LocalizedString;
  // Mnemonics are first-class content, not decoration — neuro is the most
  // mnemonic-dense subject in medicine, and this user's primary play type is
  // Storyteller (design doc §9).
  mnemonic?: LocalizedString;
}

// ---------------------------------------------------------------------------
// Tracts / pathways
// ---------------------------------------------------------------------------

export type TractModality =
  | 'ascending-sensory'
  | 'descending-motor'
  | 'other';

export interface Tract extends ContentBase {
  name: LocalizedString;
  aliases?: string[];
  modality: TractModality;
  origin: LocalizedString;
  // Where (and whether) it crosses the midline — the single most clinically
  // load-bearing fact about a tract, so it is required, not optional.
  decussationLevel: LocalizedString;
  destination: LocalizedString;
  function: LocalizedString;
  lesionEffect: LocalizedString;
  mnemonic?: LocalizedString;
}

// ---------------------------------------------------------------------------
// Vascular territories
// ---------------------------------------------------------------------------

export interface VascularTerritory extends ContentBase {
  artery: LocalizedString;
  supplies: StructureRef[];
  deficitIfOccluded: LocalizedString;
}

// ---------------------------------------------------------------------------
// Clinical syndromes (the fuel for Cases / lesion-detective)
// ---------------------------------------------------------------------------

// One deficit in a syndrome, tied to the structure/tract that produces it —
// this linkage is what lets the Cases "why" panel explain each finding
// mechanistically (design doc §7).
export interface SyndromeDeficit {
  description: LocalizedString;
  causedBy?: StructureRef | TractRef; // the structure/tract whose lesion causes it
}

export interface Syndrome extends ContentBase {
  name: LocalizedString;
  aliases?: string[];
  level: NeuraxisLevel;
  side?: Side; // the localizing side, when the syndrome has one
  lesionSite: LocalizedString; // prose description of where the lesion sits
  vignette: LocalizedString; // the case presentation shown to the player
  deficits: SyndromeDeficit[];
  mnemonic?: LocalizedString;
}

// ---------------------------------------------------------------------------
// Cross-sections (the clickable Atlas diagrams)
// ---------------------------------------------------------------------------

// A hotspot ties a region of an SVG to a Structure. The SVG geometry itself
// lives with the diagram component (src/diagrams/*); this record only carries
// the mapping and the accessible label order (design doc §8.6 — focus order
// follows anatomical reading order, authored explicitly).
export interface CrossSectionHotspot {
  structureId: StructureRef;
  // Index into the SVG's focus/reading order (dorsal→ventral, medial→lateral).
  readingOrder: number;
}

export interface CrossSection extends ContentBase {
  name: LocalizedString;
  level: NeuraxisLevel;
  // Which diagram component renders this section (resolved in src/diagrams).
  diagramKey: string;
  hotspots: CrossSectionHotspot[];
}

// ---------------------------------------------------------------------------
// Curriculum — Acts → Chapters (the journey map skeleton)
// ---------------------------------------------------------------------------

// A Chapter is one region-node on the map. It names the structures/tracts/etc.
// it teaches; the modes scope to those ids. Content ids may be empty during
// early increments (the node renders as "not yet authored").
export interface Chapter {
  id: string;
  title: LocalizedString;
  // Ids of the content this chapter draws on. Empty = skeleton only.
  structureIds?: StructureRef[];
  tractIds?: TractRef[];
  syndromeIds?: string[];
  crossSectionIds?: string[];
}

export interface Act {
  id: string;
  index: number; // 0..6, caudal→rostral order on the map
  title: LocalizedString;
  subtitle: LocalizedString;
  levels: NeuraxisLevel[]; // which neuraxis levels this act covers
  chapters: Chapter[];
  // Act 0 is the tutorial/onboarding, not graded content (design doc §3).
  isTutorial?: boolean;
}
