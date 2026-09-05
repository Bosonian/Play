import type { RegimenItem } from './regimen';

export const MEDICINE_IMPORT_SCHEMA_VERSION = 1 as const;
export const MEDICINE_IMPORT_PARSER_VERSION = 1 as const;

export interface MedicineOcrLine {
  id: string;
  text: string;
}

export interface MedicineEvidence {
  lineId: string;
  substring: string;
}

export interface EvidenceValue<T> {
  value: T;
  evidence: MedicineEvidence[];
}

export interface ParsedMedicineSourceV1 {
  sourceLineIds: string[];
  sourceText: string;
  nameSuggestion?: EvidenceValue<string>;
  formulationSuggestion?: EvidenceValue<string>;
  strengthSuggestion?: EvidenceValue<string>;
  explicitDoses?: EvidenceValue<Array<{ time: string; doseMg: number }>>;
  prnSuggestion?: EvidenceValue<boolean>;
  prnDoseSuggestion?: EvidenceValue<number>;
  indicationSuggestion?: EvidenceValue<string>;
  instructionsSuggestion: EvidenceValue<string>;
  unresolved: string[];
}

export type ParsedMedicineCandidate = ParsedMedicineSourceV1;

export interface ParsedMedicineImport {
  schemaVersion: typeof MEDICINE_IMPORT_SCHEMA_VERSION;
  parserVersion: typeof MEDICINE_IMPORT_PARSER_VERSION;
  candidates: ParsedMedicineSourceV1[];
}

const LABEL = /^(?:Medikament|Arzneimittel|Medicine)\s*:\s*(.+)$/i;
const FORMULATION = /\b(?:Retardtablette(?:n)?|Filmtablette(?:n)?|Tablette(?:n)?|Kapsel(?:n)?|Pflaster|retard(?:iert)?|dispersible|immediate-release|prolonged-release|extended-release)\b/i;
const STRENGTH = /\b\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)*\s*(?:mg|µg|mcg)\b(?!\s*\/)/gi;
const PRN_MARKER = /\b(?:bei Bedarf|PRN|as needed)\b/i;
const LABELED_INDICATION = /^(?:Indikation|Condition|When)\s*:\s*(.+)$/i;
const INLINE_INDICATION = /\b(?:bei Bedarf\s+(bei\s+.+)|as needed\s+(for\s+.+))$/i;
const GRID = /\b\d+(?:[¼½¾.,]\d*)?(?:\s*-\s*\d+(?:[¼½¾.,]\d*)?){1,3}\b/;
const TIME_AT_START = /^\s*\d{2,3}:\d{2}\b/;
const NON_NAME_START = /^(?:Dosis|Dose|Indikation|Condition|When|Schema)\s*:/i;
const NUMBER = '(\\d+(?:[.,]\\d+)?)';
const TIME = '((?:[01]\\d|2[0-3]):[0-5]\\d)';
const LABELED_DOSE = new RegExp(`(?:Dosis|Dose):\\s*${NUMBER}\\s*mg\\s+um\\s*${TIME}`, 'gi');
const TIME_DOSE = new RegExp(`${TIME}\\s*[—–-]\\s*${NUMBER}\\s*mg`, 'gi');
const DOSE_LABEL_CONTEXT = /\b(?:Dosis|Dose)\s*:/i;
const CLOCK_CONTEXT = /(?:^|[^\d])\d{2,3}:\d{2}(?!\d)/;
const ALLOWED_CLAUSE_SEPARATORS = /^[\s,;|]*$/;
const PRN_DOSE = new RegExp(`(?:^|[^\\d])(?:Dosis|Dose):\\s*${NUMBER}\\s*mg\\s*(?:bei Bedarf|PRN|as needed)(?!\\w)`, 'gi');

interface ClauseMatch<T> {
  value: T;
  evidence: MedicineEvidence;
  start: number;
  end: number;
}

function evidence<T>(value: T, lineId: string, substring: string): EvidenceValue<T> {
  return { value, evidence: [{ lineId, substring }] };
}

function parseDoseNumber(text: string): number | null {
  const match = /^(\d+)(?:([.,])(\d+))?$/.exec(text);
  if (!match) return null;
  if (match[2] && match[3].length === 3 && match[1] !== '0') return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function exactClause(match: RegExpExecArray): { substring: string; start: number; end: number } {
  const raw = match[0];
  const prefixLength = raw.length > 0 && /[^\dA-Za-z]/.test(raw[0]) ? 1 : 0;
  return {
    substring: raw.slice(prefixLength),
    start: match.index + prefixLength,
    end: match.index + raw.length,
  };
}

function collectScheduledDoses(line: MedicineOcrLine): {
  matches: ClauseMatch<{ time: string; doseMg: number }>[];
  unsupported: boolean;
} {
  const matches: ClauseMatch<{ time: string; doseMg: number }>[] = [];
  LABELED_DOSE.lastIndex = 0;
  for (let match = LABELED_DOSE.exec(line.text); match; match = LABELED_DOSE.exec(line.text)) {
    const dose = parseDoseNumber(match[1]);
    if (dose === null) continue;
    const clause = exactClause(match);
    matches.push({
      value: { time: match[2], doseMg: dose },
      evidence: { lineId: line.id, substring: clause.substring },
      start: clause.start,
      end: clause.end,
    });
  }
  TIME_DOSE.lastIndex = 0;
  for (let match = TIME_DOSE.exec(line.text); match; match = TIME_DOSE.exec(line.text)) {
    const dose = parseDoseNumber(match[2]);
    if (dose === null) continue;
    const clause = exactClause(match);
    matches.push({
      value: { time: match[1], doseMg: dose },
      evidence: { lineId: line.id, substring: clause.substring },
      start: clause.start,
      end: clause.end,
    });
  }
  matches.sort((a, b) => a.start - b.start);
  const hasScheduleContext = (DOSE_LABEL_CONTEXT.test(line.text) && /\bum\b/i.test(line.text))
    || CLOCK_CONTEXT.test(line.text)
    || GRID.test(line.text);
  if (matches.length === 0) return { matches: [], unsupported: hasScheduleContext };
  let cursor = 0;
  for (const match of matches) {
    if (!ALLOWED_CLAUSE_SEPARATORS.test(line.text.slice(cursor, match.start))) {
      return { matches: [], unsupported: true };
    }
    cursor = match.end;
  }
  if (!ALLOWED_CLAUSE_SEPARATORS.test(line.text.slice(cursor))) {
    return { matches: [], unsupported: true };
  }
  return { matches, unsupported: false };
}

function literalName(line: MedicineOcrLine): EvidenceValue<string> | undefined {
  const trimmed = line.text.trim();
  if (!trimmed || TIME_AT_START.test(trimmed) || NON_NAME_START.test(trimmed)) return undefined;
  const labeled = LABEL.exec(trimmed);
  const candidate = labeled?.[1] ?? trimmed;
  let end = candidate.length;
  for (const pattern of [STRENGTH, FORMULATION, PRN_MARKER, GRID]) {
    pattern.lastIndex = 0;
    const match = pattern.exec(candidate);
    if (match && match.index < end) end = match.index;
  }
  const value = candidate.slice(0, end).replace(/[,:;\s—–-]+$/g, '').trim();
  if (!value || !/[\p{L}]/u.test(value)) return undefined;
  const sourceIndex = line.text.indexOf(value);
  return evidence(
    value,
    line.id,
    sourceIndex >= 0 ? line.text.slice(sourceIndex, sourceIndex + value.length) : value,
  );
}

function uniqueValues<T>(values: Array<ClauseMatch<T>>, key: (value: T) => string): Array<ClauseMatch<T>> {
  const found = new Map<string, ClauseMatch<T>>();
  for (const value of values) found.set(key(value.value), value);
  return [...found.values()];
}

export function parseMedicineSourceV1(lines: MedicineOcrLine[]): ParsedMedicineSourceV1 {
  const selected = lines.filter((line) => line.text.trim().length > 0);
  const sourceText = selected.map((line) => line.text).join('\n');
  const allEvidence = selected.map((line) => ({ lineId: line.id, substring: line.text }));
  const unresolved = new Set<string>();

  const nameSuggestion = selected[0] ? literalName(selected[0]) : undefined;
  if (!nameSuggestion) unresolved.add('medicine identity');

  let formulationSuggestion: EvidenceValue<string> | undefined;
  const strengthMatches: ClauseMatch<string>[] = [];
  const scheduled: ClauseMatch<{ time: string; doseMg: number }>[] = [];
  const prnMarkers: ClauseMatch<boolean>[] = [];
  const prnDoses: ClauseMatch<number>[] = [];
  const indications: ClauseMatch<string>[] = [];

  for (const line of selected) {
    const scheduledResult = collectScheduledDoses(line);
    const lineScheduled = scheduledResult.matches;
    scheduled.push(...lineScheduled);
    if (scheduledResult.unsupported) unresolved.add('unsupported or qualified dose direction');

    if (!formulationSuggestion) {
      const form = FORMULATION.exec(line.text);
      if (form) formulationSuggestion = evidence(form[0], line.id, form[0]);
    }

    const marker = PRN_MARKER.exec(line.text);
    if (marker) {
      prnMarkers.push({
        value: true,
        evidence: { lineId: line.id, substring: marker[0] },
        start: marker.index,
        end: marker.index + marker[0].length,
      });
    }

    const linePrnDoses: ClauseMatch<number>[] = [];
    PRN_DOSE.lastIndex = 0;
    for (let match = PRN_DOSE.exec(line.text); match; match = PRN_DOSE.exec(line.text)) {
      const dose = parseDoseNumber(match[1]);
      if (dose === null) continue;
      const clause = exactClause(match);
      linePrnDoses.push({
        value: dose,
        evidence: { lineId: line.id, substring: clause.substring },
        start: clause.start,
        end: clause.end,
      });
    }
    // Only a complete standalone PRN dose clause is a numeric suggestion.
    // Inline conditions/alternatives remain source text for explicit review.
    const supportedPrn = linePrnDoses.length === 1
      && ALLOWED_CLAUSE_SEPARATORS.test(line.text.slice(0, linePrnDoses[0].start))
      && ALLOWED_CLAUSE_SEPARATORS.test(line.text.slice(linePrnDoses[0].end));
    if (supportedPrn) prnDoses.push(...linePrnDoses);
    else if (linePrnDoses.length > 0 || (marker && DOSE_LABEL_CONTEXT.test(line.text))) {
      unresolved.add('unsupported or qualified PRN direction');
    }
    if (/\b(?:nicht|kein|keine|never|do not|montags?|dienstags?|mittwochs?|donnerstags?|freitags?|samstags?|sonntags?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(line.text)) {
      unresolved.add('unsupported or qualified dose direction');
    }

    const labeledIndication = LABELED_INDICATION.exec(line.text.trim());
    const inlineIndication = INLINE_INDICATION.exec(line.text);
    const indication = labeledIndication?.[1] ?? inlineIndication?.[1] ?? inlineIndication?.[2];
    if (indication?.trim()) {
      const value = indication.trim();
      const start = line.text.indexOf(value);
      indications.push({
        value,
        evidence: { lineId: line.id, substring: value },
        start,
        end: start + value.length,
      });
    }

    // Unsupported dose text stays manual-review evidence and is never
    // reclassified as product strength.
    if (scheduledResult.unsupported || DOSE_LABEL_CONTEXT.test(line.text) || CLOCK_CONTEXT.test(line.text)) continue;
    STRENGTH.lastIndex = 0;
    for (let match = STRENGTH.exec(line.text); match; match = STRENGTH.exec(line.text)) {
      const start = match.index;
      const end = start + match[0].length;
      const isDose = [...lineScheduled, ...linePrnDoses]
        .some((clause) => start >= clause.start && end <= clause.end);
      if (!isDose) {
        strengthMatches.push({
          value: match[0],
          evidence: { lineId: line.id, substring: match[0] },
          start,
          end,
        });
      }
    }
  }

  const distinctStrengths = uniqueValues(strengthMatches, (value) => value.toLocaleLowerCase());
  const strengthSuggestion = distinctStrengths[0]
    ? { value: distinctStrengths[0].value, evidence: [distinctStrengths[0].evidence] }
    : undefined;
  if (distinctStrengths.length > 1) unresolved.add('conflicting product strengths');

  const scheduledByTime = new Map<string, Set<number>>();
  for (const item of scheduled) {
    const doses = scheduledByTime.get(item.value.time) ?? new Set<number>();
    doses.add(item.value.doseMg);
    scheduledByTime.set(item.value.time, doses);
  }
  const conflictingTimes = [...scheduledByTime.values()].some((doses) => doses.size > 1);
  if (conflictingTimes) unresolved.add('conflicting doses at the same time');
  const explicitDoses = scheduled.length > 0 && !conflictingTimes
    ? { value: scheduled.map((item) => item.value), evidence: scheduled.map((item) => item.evidence) }
    : undefined;

  const prnSuggestion = prnMarkers[0]
    ? { value: true as const, evidence: prnMarkers.map((item) => item.evidence) }
    : undefined;
  const distinctPrnDoses = uniqueValues(prnDoses, (value) => String(value));
  const prnDoseSuggestion = distinctPrnDoses.length === 1
    ? { value: distinctPrnDoses[0].value, evidence: [distinctPrnDoses[0].evidence] }
    : undefined;
  if (distinctPrnDoses.length > 1) unresolved.add('conflicting PRN doses');
  const distinctIndications = uniqueValues(indications, (value) => value.toLocaleLowerCase());
  const indicationSuggestion = distinctIndications.length === 1
    ? { value: distinctIndications[0].value, evidence: [distinctIndications[0].evidence] }
    : undefined;
  if (distinctIndications.length > 1) unresolved.add('conflicting PRN indications');

  // A scheduled prescription may only omit source text from its structured
  // representation when every non-product character is explained by an exact
  // dose clause. Unknown continuation lines can be course limits or conditions.
  if (!prnSuggestion && explicitDoses) {
    const explained = [
      ...(nameSuggestion?.evidence ?? []),
      ...(formulationSuggestion?.evidence ?? []),
      ...(strengthSuggestion?.evidence ?? []),
      ...explicitDoses.evidence,
    ];
    for (const line of selected) {
      const covered = Array<boolean>(line.text.length).fill(false);
      for (const item of explained.filter((item) => item.lineId === line.id)) {
        const start = line.text.indexOf(item.substring);
        if (start >= 0) covered.fill(true, start, start + item.substring.length);
      }
      const residue = [...line.text].map((char, index) => covered[index] ? ' ' : char)
        .join('').replace(/^\s*(?:Medikament|Arzneimittel|Medicine)\s*:/i, '');
      if (!/^[\s,;|:—–-]*$/.test(residue)) {
        unresolved.add('unsupported or qualified dose direction');
      }
    }
  }

  if (prnSuggestion && explicitDoses) unresolved.add('mixed scheduled and PRN directions');
  if (!formulationSuggestion) unresolved.add('formulation');
  if (prnSuggestion) {
    if (!prnDoseSuggestion) unresolved.add('PRN dose');
    if (!indicationSuggestion) unresolved.add('PRN indication');
  } else if (!explicitDoses) {
    unresolved.add('prescribed dose');
    unresolved.add('schedule');
  }

  return {
    sourceLineIds: selected.map((line) => line.id),
    sourceText,
    ...(nameSuggestion ? { nameSuggestion } : {}),
    ...(formulationSuggestion ? { formulationSuggestion } : {}),
    ...(strengthSuggestion ? { strengthSuggestion } : {}),
    ...(explicitDoses ? { explicitDoses } : {}),
    ...(prnSuggestion ? { prnSuggestion } : {}),
    ...(prnDoseSuggestion ? { prnDoseSuggestion } : {}),
    ...(indicationSuggestion ? { indicationSuggestion } : {}),
    instructionsSuggestion: { value: sourceText, evidence: allEvidence },
    unresolved: [...unresolved],
  };
}

export function parseMedicineOcrLines(lines: MedicineOcrLine[]): ParsedMedicineImport {
  const blocks: MedicineOcrLine[][] = [];
  let current: MedicineOcrLine[] = [];
  for (const line of lines) {
    if (LABEL.test(line.text.trim()) && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);
  return {
    schemaVersion: MEDICINE_IMPORT_SCHEMA_VERSION,
    parserVersion: MEDICINE_IMPORT_PARSER_VERSION,
    candidates: blocks
      .filter((block) => block.some((line) => line.text.trim()))
      .map(parseMedicineSourceV1),
  };
}

export interface MedicationImportReceipt {
  id: string;
  patient: string;
  provider: 'google-cloud-vision';
  feature: 'DOCUMENT_TEXT_DETECTION';
  region: 'eu';
  schemaVersion: number;
  parserVersion: number;
  imageSha256: string;
  actor: 'local-doctor-mode';
  appliedAt: string;
  payloadFingerprint: string;
  confirmedItems: RegimenItem[];
}
