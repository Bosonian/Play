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

// Content tables — filled in later increments (Increment 2: the spinal-cord
// vertical slice).
export const STRUCTURES: Structure[] = [];
export const TRACTS: Tract[] = [];
export const VASCULAR: VascularTerritory[] = [];
export const SYNDROMES: Syndrome[] = [];
export const CROSS_SECTIONS: CrossSection[] = [];

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
