// The assembled content bundle — the single import point for all anatomy data.
//
// In Increment 1 only the curriculum skeleton is populated; the content tables
// are empty and fill in later increments. `CONTENT` is what modes and the map
// read from.

import type {
  Structure,
  Tract,
  VascularTerritory,
  Syndrome,
  CrossSection,
} from './types';
import { CURRICULUM } from './curriculum';
import { validateContent, type ContentLintIssue } from './schema';
import {
  cordStructures,
  cordTracts,
  cordSyndromes,
  cordCrossSections,
} from './data/spinalCord';

// Content tables. The spinal-cord slice (Increment 2) is the first authored
// content; the rest of the neuraxis pours in here act by act.
export const STRUCTURES: Structure[] = [...cordStructures];
export const TRACTS: Tract[] = [...cordTracts];
export const VASCULAR: VascularTerritory[] = [];
export const SYNDROMES: Syndrome[] = [...cordSyndromes];
export const CROSS_SECTIONS: CrossSection[] = [...cordCrossSections];

export const CONTENT = {
  structures: STRUCTURES,
  tracts: TRACTS,
  vascular: VASCULAR,
  syndromes: SYNDROMES,
  crossSections: CROSS_SECTIONS,
  curriculum: CURRICULUM,
};

export { CURRICULUM };
export * from './types';

// Id → record lookups, for the modes and question generator.
export const byId = {
  structure: new Map(STRUCTURES.map((s) => [s.id, s])),
  tract: new Map(TRACTS.map((t) => [t.id, t])),
  syndrome: new Map(SYNDROMES.map((s) => [s.id, s])),
  crossSection: new Map(CROSS_SECTIONS.map((c) => [c.id, c])),
};

// Dev-only content check: validate shape + cross-references at startup and log
// any issues to the console. This is how an orphan reference or a half-authored
// record gets caught before it can show a wrong answer. Guarded by import.meta
// so it's stripped from the production bundle.
export function runContentLintInDev(): void {
  if (!import.meta.env.DEV) return;
  const issues: ContentLintIssue[] = validateContent(CONTENT);
  if (issues.length === 0) {
    // eslint-disable-next-line no-console
    console.info('[content] validation clean');
    return;
  }
  for (const issue of issues) {
    const line = `[content:${issue.severity}] ${issue.where} — ${issue.message}`;
    // eslint-disable-next-line no-console
    if (issue.severity === 'error') console.error(line);
    // eslint-disable-next-line no-console
    else console.warn(line);
  }
}
