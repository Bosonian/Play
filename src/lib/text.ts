// Tiny localization accessor. v1 is English-only, but every human-facing string
// is stored as { en, de? } so a German toggle is a later feature, not a rebuild
// (design doc §12). `tr()` is the one place that resolves a LocalizedString to
// the active language — today it always returns `en`; when German lands, this
// is where the language choice is read.

import type { LocalizedString } from '../content/types';

export function tr(s: LocalizedString): string {
  return s.en;
}
