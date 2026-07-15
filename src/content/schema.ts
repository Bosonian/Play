// Runtime validation for the content model (design doc §11 — content pipeline
// hardening). These Zod schemas mirror the TypeScript types in ./types.ts and
// are the runtime source of truth: content is validated on load, so a
// malformed record fails loudly in dev rather than showing a wrong answer to a
// neurologist. `validateContent()` also runs the cross-reference lint (orphan
// refs), which types alone can't catch.
//
// Keep in sync with ./types.ts. If you add a field there, add it here.

import { z } from 'zod';
import { NEURAXIS_LEVELS } from './types';

export const localizedString = z.object({
  en: z.string().min(1),
  de: z.string().min(1).optional(),
});

export const reviewStatus = z.enum(['draft', 'verified']);
export const neuraxisLevel = z.enum(NEURAXIS_LEVELS);
export const side = z.enum(['left', 'right', 'midline']);

const contentBase = {
  id: z.string().min(1),
  reviewStatus,
  contested: z.boolean().optional(),
  note: z.string().optional(),
};

export const structureSchema = z.object({
  ...contentBase,
  name: localizedString,
  aliases: z.array(z.string()).optional(),
  level: neuraxisLevel,
  type: z.enum([
    'nucleus',
    'deep-nucleus',
    'tract-column',
    'gray-region',
    'gyrus',
    'cortical-area',
    'ventricle',
    'vascular',
    'nerve',
    'region',
  ]),
  function: localizedString,
  clinicalNote: localizedString.optional(),
  mnemonic: localizedString.optional(),
});

export const tractSchema = z.object({
  ...contentBase,
  name: localizedString,
  aliases: z.array(z.string()).optional(),
  modality: z.enum(['ascending-sensory', 'descending-motor', 'other']),
  origin: localizedString,
  decussationLevel: localizedString,
  destination: localizedString,
  function: localizedString,
  lesionEffect: localizedString,
  mnemonic: localizedString.optional(),
});

export const vascularTerritorySchema = z.object({
  ...contentBase,
  artery: localizedString,
  supplies: z.array(z.string()),
  deficitIfOccluded: localizedString,
});

export const syndromeSchema = z.object({
  ...contentBase,
  name: localizedString,
  aliases: z.array(z.string()).optional(),
  level: neuraxisLevel,
  side: side.optional(),
  lesionSite: localizedString,
  vignette: localizedString,
  deficits: z.array(
    z.object({
      description: localizedString,
      causedBy: z.string().optional(),
    }),
  ),
  mnemonic: localizedString.optional(),
});

export const crossSectionSchema = z.object({
  ...contentBase,
  name: localizedString,
  level: neuraxisLevel,
  diagramKey: z.string().min(1),
  hotspots: z.array(
    z.object({
      structureId: z.string().min(1),
      readingOrder: z.number().int().nonnegative(),
    }),
  ),
});

export const chapterSchema = z.object({
  id: z.string().min(1),
  title: localizedString,
  structureIds: z.array(z.string()).optional(),
  tractIds: z.array(z.string()).optional(),
  syndromeIds: z.array(z.string()).optional(),
  crossSectionIds: z.array(z.string()).optional(),
});

export const actSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(0),
  title: localizedString,
  subtitle: localizedString,
  levels: z.array(neuraxisLevel).min(1),
  chapters: z.array(chapterSchema),
  isTutorial: z.boolean().optional(),
});

// The whole content bundle, so it can be validated in one call.
export const contentBundleSchema = z.object({
  structures: z.array(structureSchema),
  tracts: z.array(tractSchema),
  vascular: z.array(vascularTerritorySchema),
  syndromes: z.array(syndromeSchema),
  crossSections: z.array(crossSectionSchema),
  curriculum: z.array(actSchema),
});

export type ContentBundle = z.infer<typeof contentBundleSchema>;

export interface ContentLintIssue {
  severity: 'error' | 'warning';
  where: string;
  message: string;
}

// Validate a content bundle: Zod shape check first, then cross-reference lint
// (the checks types can't do). Returns a list of issues; empty = clean.
//
// Called in dev at startup so content problems surface immediately. In
// production the app trusts already-shipped content and skips this (it would
// only re-find issues that dev already caught).
export function validateContent(bundle: unknown): ContentLintIssue[] {
  const issues: ContentLintIssue[] = [];

  const parsed = contentBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    for (const err of parsed.error.issues) {
      issues.push({
        severity: 'error',
        where: err.path.join('.') || '(root)',
        message: err.message,
      });
    }
    // Shape is broken; cross-ref lint would just add noise. Stop here.
    return issues;
  }

  const b = parsed.data;

  // Duplicate ids silently drop records when byId maps are built (last write
  // wins) — a real wrong-answer/data-loss path. Catch it here.
  const findDups = (items: { id: string }[], label: string) => {
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.id)) {
        issues.push({ severity: 'error', where: label, message: `duplicate id "${it.id}"` });
      }
      seen.add(it.id);
    }
  };
  findDups(b.structures, 'structures');
  findDups(b.tracts, 'tracts');
  findDups(b.syndromes, 'syndromes');
  findDups(b.crossSections, 'crossSections');

  const structureIds = new Set(b.structures.map((s) => s.id));
  const tractIds = new Set(b.tracts.map((t) => t.id));
  const syndromeIds = new Set(b.syndromes.map((s) => s.id));
  const crossSectionIds = new Set(b.crossSections.map((c) => c.id));

  // Orphan reference: a record pointing at an id that doesn't exist.
  const refExists = (id: string) =>
    structureIds.has(id) || tractIds.has(id);

  for (const v of b.vascular) {
    for (const ref of v.supplies) {
      if (!structureIds.has(ref)) {
        issues.push({
          severity: 'error',
          where: `vascular.${v.id}.supplies`,
          message: `references unknown structure "${ref}"`,
        });
      }
    }
  }

  for (const s of b.syndromes) {
    for (const d of s.deficits) {
      if (d.causedBy && !refExists(d.causedBy)) {
        issues.push({
          severity: 'error',
          where: `syndrome.${s.id}.deficits`,
          message: `causedBy references unknown structure/tract "${d.causedBy}"`,
        });
      }
    }
  }

  for (const c of b.crossSections) {
    for (const h of c.hotspots) {
      if (!structureIds.has(h.structureId)) {
        issues.push({
          severity: 'error',
          where: `crossSection.${c.id}.hotspots`,
          message: `references unknown structure "${h.structureId}"`,
        });
      }
    }
  }

  // Curriculum chapters may reference content that isn't authored yet (early
  // increments) — so a missing ref here is a warning, not an error.
  for (const act of b.curriculum) {
    for (const ch of act.chapters) {
      const check = (
        ids: string[] | undefined,
        set: Set<string>,
        kind: string,
      ) => {
        for (const id of ids ?? []) {
          if (!set.has(id)) {
            issues.push({
              severity: 'warning',
              where: `curriculum.${act.id}.${ch.id}`,
              message: `${kind} "${id}" not authored yet`,
            });
          }
        }
      };
      check(ch.structureIds, structureIds, 'structure');
      check(ch.tractIds, tractIds, 'tract');
      check(ch.syndromeIds, syndromeIds, 'syndrome');
      check(ch.crossSectionIds, crossSectionIds, 'cross-section');
    }
  }

  return issues;
}
