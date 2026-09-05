import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MEDICINE_IMPORT_PARSER_VERSION,
  MEDICINE_IMPORT_SCHEMA_VERSION,
  parseMedicineSourceV1,
  type MedicineOcrLine,
  type MedicineEvidence,
  type ParsedMedicineCandidate,
} from '../../../domain/medicineImport';
import { DRUG_CATALOG, isCatalogDrug } from '../../../domain/drugs';
import {
  medicationLookupOptions,
  normalizeMedicationName,
  type CustomMedication,
  type MedicationLookupOption,
} from '../../../domain/medicationLookup';
import type { RegimenItem } from '../../../domain/regimen';
import type { ApplyMedicationImportInput } from '../../db/store';
import { safeUuid } from '../../lib/uuid';
import { isMedicineOcrNativeAvailable, medicineOcrNative } from '../../medicineOcr/native';
import { preflightMedicineImage } from '../../medicineOcr/imagePreflight';
import { doseHelperCaption } from './RegimenItemForm';
import {
  buildReviewedRegimenItem,
  candidateToReviewDraft,
  ocrResultBelongsToRequest,
  type MedicinePhotoReviewDraft,
  unresolvedReviewFields,
} from './medicinePhotoReview';

type OcrStatus = Awaited<ReturnType<typeof medicineOcrNative.getStatus>>;
type OcrResult = Awaited<ReturnType<typeof medicineOcrNative.extractPhoto>>;
type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

const MAX_IMAGE_EDGE = 4096;
const MAX_NORMALIZED_BYTES = 8 * 1024 * 1024;

export function boundedImageDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this photo.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export async function normalizeMedicinePhoto(file: File): Promise<{
  base64: string;
  preview: string;
  mimeType: 'image/jpeg';
}> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  const encoded = await preflightMedicineImage(file, file.type);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Could not decode this photo.');
  }
  const decodedMatchesHeader = (bitmap.width === encoded.width && bitmap.height === encoded.height)
    || (bitmap.width === encoded.height && bitmap.height === encoded.width);
  if (!decodedMatchesHeader) {
    bitmap.close();
    throw new Error('The decoded photo dimensions do not match its encoded header.');
  }
  const dimensions = boundedImageDimensions(bitmap.width, bitmap.height);
  if (!dimensions) {
    bitmap.close();
    throw new Error('The photo has invalid dimensions.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('Could not prepare this photo.');
  }
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const normalized = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare this photo.')), 'image/jpeg', 0.9));
  canvas.width = 1;
  canvas.height = 1;
  if (normalized.size > MAX_NORMALIZED_BYTES) throw new Error('The normalized photo is too large.');
  const preview = await blobDataUrl(normalized);
  const comma = preview.indexOf(',');
  if (comma < 0) throw new Error('Could not read this photo.');
  return { base64: preview.slice(comma + 1), preview, mimeType: 'image/jpeg' };
}

const inputClass = 'mt-1 w-full rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg';
const primaryClass = 'rounded-md bg-accent px-4 py-2 text-label text-white disabled:opacity-60';

const secondaryClass = 'text-label text-fg-muted underline underline-offset-2 disabled:opacity-60';

export function MedicinePhotoPreview({ src, alt }: { src: string; alt: string }) {
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(100);
  return (
    <>
      <button type="button" onClick={() => { setZoom(100); setExpanded(true); }}
        className="block w-full rounded-sm focus:outline-none focus:ring-2 focus:ring-accent"
        aria-label={'Enlarge ' + alt.toLowerCase()}>
        <img src={src} alt={alt} className="max-h-64 w-full rounded-sm bg-bg object-contain" />
        <span className="mt-1 block text-label text-fg-muted underline underline-offset-2">Enlarge photo</span>
      </button>
      {expanded && (
        <div role="dialog" aria-modal="true" aria-label="Enlarged medicine photo"
          className="fixed inset-0 z-50 flex flex-col bg-bg p-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <p className="text-body font-medium text-fg">Enlarged medicine photo</p>
            <div className="flex items-center gap-4">
              <button type="button" disabled={zoom <= 100} onClick={() => setZoom((value) => Math.max(100, value - 50))}
                className={secondaryClass} aria-label="Zoom out photo">Zoom out</button>
              <span className="text-label text-fg-muted" aria-live="polite">{zoom}%</span>
              <button type="button" disabled={zoom >= 300} onClick={() => setZoom((value) => Math.min(300, value + 50))}
                className={secondaryClass} aria-label="Zoom in photo">Zoom in</button>
              <button type="button" onClick={() => setExpanded(false)} className={primaryClass}>Close</button>
            </div>
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-sm border border-line bg-surface-soft p-2">
            <img src={src} alt={alt} className="h-auto max-w-none" style={{ width: String(zoom) + '%' }} />
          </div>
        </div>
      )}
    </>
  );
}

function connectionLabel(state: OcrStatus['checkState']): string {
  switch (state) {
    case 'ok': return 'Connection tested successfully';
    case 'failed': return 'Last connection test failed';
    case 'configuration-error': return 'Configuration needs attention';
    case 'not-tested': return 'Connection not tested';
    case 'not-configured': return 'API key not configured';
  }
}

export function MedicinePhotoImport({
  patientCode,
  savedMedications,
  onApply,
  onBack,
}: {
  patientCode: string;
  savedMedications: CustomMedication[];
  onApply: (input: ApplyMedicationImportInput) => Promise<void>;
  onBack: () => void;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<OcrStatus | null>(null);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [photo, setPhoto] = useState<{ base64: string; mimeType: ImageMime; preview: string } | null>(null);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [candidate, setCandidate] = useState<ParsedMedicineCandidate | null>(null);
  const [draft, setDraft] = useState<MedicinePhotoReviewDraft | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [confirmedIdentity, setConfirmedIdentity] = useState(false);
  const [confirmedProduct, setConfirmedProduct] = useState(false);
  const [confirmedDirections, setConfirmedDirections] = useState(false);
  const [reviewed, setReviewed] = useState<Array<{ item: RegimenItem; sourceLineIds: string[] }>>([]);
  const [usedLineIds, setUsedLineIds] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState(false);
  const activeRequest = useRef<string | null>(null);
  const applyRef = useRef(false);
  const pendingApplyRef = useRef<ApplyMedicationImportInput | null>(null);
  const [applyLocked, setApplyLocked] = useState(false);
  const boundPatientRef = useRef(patientCode);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const photoReadToken = useRef(0);

  async function refreshStatus() {
    const nextAvailable = isMedicineOcrNativeAvailable();
    setAvailable(nextAvailable);
    if (!nextAvailable) return;
    const next = await medicineOcrNative.getStatus();
    setStatus(next);
    setProjectId(next.projectId ?? '');
  }

  useEffect(() => {
    if (boundPatientRef.current !== patientCode) {
      boundPatientRef.current = patientCode;
      clearExtraction();
    }
  }, [patientCode]);

  useEffect(() => {
    void refreshStatus().catch((error: unknown) => {
      setAvailable(false);
      setMessage(error instanceof Error ? error.message : 'Could not read Vision setup.');
    });
    return () => {
      photoReadToken.current += 1;
      const requestId = activeRequest.current;
      activeRequest.current = null;
      if (requestId) void medicineOcrNative.cancelExtraction(requestId);
    };
  }, []);

  function clearExtraction() {
    photoReadToken.current += 1;
    const requestId = activeRequest.current;
    activeRequest.current = null;
    if (requestId) void medicineOcrNative.cancelExtraction(requestId);
    setPhoto(null);
    setOcr(null);
    setSelectedLineIds(new Set());
    setCandidate(null);
    setDraft(null);
    setReviewed([]);
    setUsedLineIds(new Set());
    setApplied(false);
    pendingApplyRef.current = null;
    setApplyLocked(false);
    setMessage(null);
    setBusy(false);
    if (photoInput.current) photoInput.current.value = '';
  }

  async function configureKey() {
    if (!projectId.trim()) {
      setMessage('Enter the Google Cloud project ID.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await medicineOcrNative.configureKey(projectId.trim());
      await refreshStatus();
      setMessage('Vision credentials saved in Android secure storage.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save Vision credentials.');
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    clearExtraction();
    setBusy(true);
    try {
      await medicineOcrNative.removeKey();
      await refreshStatus();
      setMessage('Vision API key removed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove the API key.');
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setMessage(null);
    try {
      await medicineOcrNative.testConnection();
      await refreshStatus();
      setMessage('Google Cloud Vision connection succeeded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Vision connection failed.');
    } finally {
      setBusy(false);
    }
  }

  async function selectPhoto(file: File | undefined) {
    if (!file) return;
    clearExtraction();
    const readToken = photoReadToken.current;
    try {
      const image = await normalizeMedicinePhoto(file);
      if (photoReadToken.current !== readToken) return;
      setPhoto(image);
      if (photoInput.current) photoInput.current.value = '';
    } catch (error) {
      if (photoReadToken.current !== readToken) return;
      setMessage(error instanceof Error ? error.message : 'Could not read this photo.');
    }
  }

  async function extract() {
    if (!photo) return;
    if (!disclosureAccepted) {
      setMessage('Confirm the Google Cloud Vision disclosure before extracting text.');
      return;
    }
    const requestId = safeUuid();
    activeRequest.current = requestId;
    setBusy(true);
    setMessage(null);
    try {
      const result = await medicineOcrNative.extractPhoto({
        requestId,
        imageBase64: photo.base64,
        mimeType: photo.mimeType,
      });
      if (!ocrResultBelongsToRequest(activeRequest.current, result)) return;
      setOcr(result);
      setSelectedLineIds(new Set());
      setMessage('Select the lines that belong to one medicine.');
    } catch (error) {
      if (activeRequest.current !== requestId) return;
      setMessage(error instanceof Error ? error.message : 'Vision could not read this photo.');
    } finally {
      if (activeRequest.current === requestId) {
        activeRequest.current = null;
        setBusy(false);
      }
    }
  }

  function cancelExtraction() {
    const requestId = activeRequest.current;
    activeRequest.current = null;
    if (requestId) void medicineOcrNative.cancelExtraction(requestId);
    setBusy(false);
    setMessage('Extraction cancelled.');
  }

  function startReview() {
    if (!ocr) return;
    const selected: MedicineOcrLine[] = ocr.lines
      .map((line, index) => ({ id: `line-${index + 1}`, text: line.text }))
      .filter((line) => selectedLineIds.has(line.id));
    const next = parseMedicineSourceV1(selected);
    setCandidate(next);
    setDraft(candidateToReviewDraft(next));
    setConfirmedIdentity(false);
    setConfirmedProduct(false);
    setConfirmedDirections(false);
    setLookupOpen(true);
    setMessage(null);
  }

  const lookupOptions = useMemo(
    () => draft ? medicationLookupOptions(draft.query, savedMedications) : [],
    [draft?.query, savedMedications],
  );

  function chooseMedicine(option: MedicationLookupOption) {
    if (!draft) return;
    setDraft({
      ...draft,
      query: option.name,
      drug: option.drug,
      customName: option.kind === 'saved' ? option.name : '',
      customFormulation: option.kind === 'saved' ? option.detail : '',
      customMedicationId: option.kind === 'saved' ? option.customMedicationId : undefined,
    });
    setConfirmedIdentity(false);
    setConfirmedProduct(false);
    setConfirmedDirections(false);
    setLookupOpen(false);
  }

  function addAsCustom() {
    if (!draft?.query.trim()) return;
    setDraft({
      ...draft,
      drug: 'custom',
      customName: draft.query.trim().replace(/\s+/g, ' '),
      customMedicationId: undefined,
    });
    setConfirmedIdentity(false);
    setConfirmedProduct(false);
    setConfirmedDirections(false);
    setLookupOpen(false);
  }

  function updateRow(index: number, field: 'time' | 'dose', value: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      rows: draft.rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row),
    });
    setConfirmedDirections(false);
  }

  function addReviewedMedicine() {
    if (!draft?.drug || !candidate) {
      setMessage('Choose a built-in or saved medicine, or explicitly add it as another medicine.');
      return;
    }
    if (!confirmedIdentity || !confirmedProduct || !confirmedDirections) {
      setMessage('Complete all three confirmations before adding this medicine.');
      return;
    }
    const result = buildReviewedRegimenItem(
      draft,
      patientCode,
      safeUuid(),
      new Date().toISOString(),
    );
    const errors = result.errors;
    if (errors.length > 0) {
      setMessage(errors.join(' '));
      return;
    }
    setReviewed((previous) => [...previous, {
      item: result.item!,
      sourceLineIds: [...candidate.sourceLineIds],
    }]);
    setUsedLineIds((previous) => new Set([...previous, ...candidate.sourceLineIds]));
    setSelectedLineIds(new Set());
    setCandidate(null);
    setDraft(null);
    setMessage('Medicine reviewed. Select lines for another medicine, or add the reviewed medicines.');
  }

  async function applyAll() {
    if (!ocr || reviewed.length === 0 || busy || applyRef.current) return;
    if (draft || candidate || selectedLineIds.size > 0) {
      setMessage('Finish or discard the selected medicine before adding the reviewed list.');
      return;
    }
    applyRef.current = true;
    let payload = pendingApplyRef.current;
    if (!payload) {
      const confirmedItems: RegimenItem[] = reviewed.map(({ item }) => ({
        ...item,
        times: item.times.map(({ time, doseMg }) => ({ time, doseMg })),
        ...(item.prn ? { prn: {
          doseMg: item.prn.doseMg,
          indication: item.prn.indication,
          ...(item.prn.instructions ? { instructions: item.prn.instructions } : {}),
        } } : {}),
      }));
      for (const item of confirmedItems) {
        Object.freeze(item.times);
        if (item.prn) Object.freeze(item.prn);
        Object.freeze(item);
      }
      Object.freeze(confirmedItems);
      payload = Object.freeze({
        id: ocr.requestId,
        patient: patientCode,
        provider: 'google-cloud-vision',
        feature: 'DOCUMENT_TEXT_DETECTION',
        region: 'eu',
        schemaVersion: MEDICINE_IMPORT_SCHEMA_VERSION,
        parserVersion: MEDICINE_IMPORT_PARSER_VERSION,
        imageSha256: ocr.imageSha256,
        actor: 'local-doctor-mode',
        appliedAt: new Date().toISOString(),
        confirmedItems,
      });
      pendingApplyRef.current = payload;
      setApplyLocked(true);
    }
    setBusy(true);
    setApplying(true);
    setMessage(null);
    try {
      await onApply(payload);
      setApplied(true);
      pendingApplyRef.current = null;
      setApplyLocked(false);
      setPhoto(null);
      setOcr(null);
      setCandidate(null);
      setDraft(null);
      if (photoInput.current) photoInput.current.value = '';
      setMessage(`${reviewed.length} medicine${reviewed.length === 1 ? '' : 's'} added.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add the reviewed medicines.');
    } finally {
      setBusy(false);
      setApplying(false);
      applyRef.current = false;
    }
  }

  if (available === false) {
    return (
      <section className="rounded-md border border-line bg-surface p-4">
        <h1 className="text-title font-medium">Medicine photo import</h1>
        <p className="mt-3 text-body text-fg">
          Photo import is available only in the Android app. Add medicines manually in this web version.
        </p>
        {message && <p className="mt-2 text-label text-warn">{message}</p>}
        <button type="button" onClick={onBack} className={`mt-6 ${secondaryClass}`}>Back</button>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <h1 className="text-title font-medium">Medicine photo import</h1>
      <p className="mt-1 text-caption text-fg-muted">Patient {patientCode}</p>

      <fieldset disabled={applyLocked} className="contents">
      <div className="mt-4 rounded-sm border border-line bg-bg p-3">
        <h2 className="text-body font-medium">Google Cloud Vision setup</h2>
        {available === null || !status ? (
          <p className="mt-2 text-body text-fg-muted">Checking Android setup…</p>
        ) : (
          <>
            <p className="mt-2 text-body text-fg">
              {status.configured ? 'API key configured' : 'API key not configured'}
            </p>
            <label className="mt-3 block text-label text-fg-muted">
              Google Cloud project ID
              <input value={projectId} onChange={(event) => setProjectId(event.target.value)}
                className={inputClass} autoComplete="off" />
            </label>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" disabled={busy} onClick={() => void configureKey()} className={primaryClass}>
                {status.configured ? 'Replace API key' : 'Add API key'}
              </button>
              {status.configured && (
                <>
                  <button type="button" disabled={busy} onClick={() => void testConnection()} className={secondaryClass}>
                    Test connection
                  </button>
                  <button type="button" disabled={busy} onClick={() => void removeKey()} className={secondaryClass}>
                    Remove API key
                  </button>
                </>
              )}
            </div>
            <p className="mt-2 text-caption text-fg-muted">
              Android package: {status.androidPackage} · Certificate SHA-1: {status.androidCertSha1}
            </p>
            <p className="mt-1 text-caption text-fg-muted">{connectionLabel(status.checkState)}</p>
          </>
        )}
      </div>

      {status?.configured && !applied && (
        <div className="mt-4">
          <label className="flex items-start gap-2 text-label text-fg">
            <input type="checkbox" checked={disclosureAccepted}
              onChange={(event) => setDisclosureAccepted(event.target.checked)} />
            <span>
              I understand that the selected photo is sent to Google Cloud Vision in the EU for text extraction.
              Companion keeps the photo, OCR text, and draft only in memory and does not save them.
            </span>
          </label>
          <label className="mt-3 block text-label text-fg-muted">
            Choose an existing medicine-list photo
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp"
              disabled={!disclosureAccepted || busy}
              onChange={(event) => void selectPhoto(event.target.files?.[0])}
              className="mt-1 block w-full text-body text-fg" />
          </label>
        </div>
      )}

      {photo && !ocr && (
        <div className="mt-4">
          <MedicinePhotoPreview src={photo.preview} alt="Selected medicine list" />
          <p className="mt-2 text-caption text-fg-muted">
            Check that the image contains no names, addresses, barcodes, or unrelated pages.
          </p>
          <div className="mt-3 flex gap-4">
            <button type="button" disabled={busy || !disclosureAccepted} onClick={() => void extract()} className={primaryClass}>
              Extract text
            </button>
            {busy && (
              <button type="button" onClick={cancelExtraction} className={secondaryClass}>Cancel extraction</button>
            )}
            {!busy && <button type="button" onClick={clearExtraction} className={secondaryClass}>Remove photo</button>}
          </div>
        </div>
      )}

      {ocr && (
        <div className="mt-5">
          <h2 className="text-body font-medium">1. Select lines for one medicine</h2>
          <p className="mt-1 text-caption text-fg-muted">
            Vision text is untrusted. Select the medicine label, formulation, and its directions only.
          </p>
          {photo && (
            <div className="mt-3">
              <MedicinePhotoPreview src={photo.preview} alt="Medicine list being reviewed" />
            </div>
          )}
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-sm border border-line bg-bg p-2">
            {ocr.lines.map((line, index) => {
              const lineId = `line-${index + 1}`;
              const used = usedLineIds.has(lineId);
              return (
                <label key={lineId} className={`flex items-start gap-2 rounded-sm p-2 text-body ${used ? 'text-fg-muted' : 'text-fg'}`}>
                  <input type="checkbox" disabled={used || draft !== null}
                    checked={selectedLineIds.has(lineId)}
                    onChange={(event) => setSelectedLineIds((previous) => {
                      const next = new Set(previous);
                      if (event.target.checked) next.add(lineId); else next.delete(lineId);
                      return next;
                    })} />
                  <span>{line.text}</span>
                  {used && <span className="ml-auto text-caption">Reviewed</span>}
                </label>
              );
            })}
          </div>
          {!draft && (
            <button type="button" disabled={selectedLineIds.size === 0} onClick={startReview}
              className={`mt-3 ${primaryClass}`}>Review selected medicine</button>
          )}
        </div>
      )}

      {draft && candidate && (
        <div className="mt-5 border-t border-line pt-4">
          <h2 className="text-body font-medium">2. Review against the photo</h2>
          {unresolvedReviewFields(draft).length > 0 && (
            <p className="mt-2 text-label text-warn">
              Still required: {unresolvedReviewFields(draft).join(', ')}. Missing values remain blank.
            </p>
          )}
          {candidate.unresolved.length > 0 && (
            <p className="mt-2 text-label text-warn">
              Source needs review: {candidate.unresolved.join(', ')}.
            </p>
          )}
          <div className="mt-3 rounded-sm border border-line bg-bg p-3">
            <p className="text-label text-fg-muted">Selected source</p>
            <p className="mt-1 whitespace-pre-wrap text-caption text-fg">{candidate.sourceText}</p>
            <p className="mt-3 text-label text-fg-muted">Parser evidence</p>
            {([
              ['medicine name', candidate.nameSuggestion],
              ['formulation', candidate.formulationSuggestion],
              ['product strength', candidate.strengthSuggestion],
              ['scheduled dose', candidate.explicitDoses],
              ['when-needed marker', candidate.prnSuggestion],
              ['when-needed dose', candidate.prnDoseSuggestion],
              ['indication', candidate.indicationSuggestion],
            ] as Array<[string, { evidence: MedicineEvidence[] } | undefined]>).flatMap(
              ([label, suggestion]) => (suggestion?.evidence ?? []).map((entry, index) => (
                <p key={`${entry.lineId}-${label}-${index}`} className="mt-1 text-caption text-fg">
                  {entry.lineId} · {label}: “{entry.substring}”
                </p>
              )),
            )}
            {candidate.strengthSuggestion && (
              <p className="mt-2 text-caption text-warn">
                Strength text only: {candidate.strengthSuggestion.value}. It was not used as a dose.
              </p>
            )}
          </div>

          <label className="mt-3 block text-label text-fg-muted">
            Medicine
            <input type="search" value={draft.query}
              onFocus={() => setLookupOpen(true)}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  query: event.target.value,
                  drug: undefined,
                  customName: '',
                  customFormulation: candidate.formulationSuggestion?.value ?? '',
                  customMedicationId: undefined,
                });
                setLookupOpen(true);
                setConfirmedIdentity(false);
                setConfirmedProduct(false);
                setConfirmedDirections(false);
              }}
              className={inputClass} placeholder="Search medicine or brand" />
          </label>
          {lookupOpen && (
            <div aria-label="Medicine search results" className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-sm border border-line bg-bg p-1">
              {lookupOptions.map((option) => (
                <button key={option.kind === 'catalog' ? option.drug : option.customMedicationId}
                  type="button" onClick={() => chooseMedicine(option)}
                  className="flex w-full justify-between rounded-sm px-3 py-2 text-left">
                  <span><span className="block text-body">{option.name}</span><span className="block text-caption text-fg-muted">{option.detail}</span></span>
                  <span className="text-caption text-fg-muted">{option.kind === 'catalog' ? 'Built-in' : 'Saved medicine'}</span>
                </button>
              ))}
              {draft.query.trim() && !lookupOptions.some((option) =>
                normalizeMedicationName(option.name) === normalizeMedicationName(draft.query)) && (
                <button type="button" onClick={addAsCustom} className="w-full px-3 py-2 text-left text-label text-accent">
                  Add “{draft.query.trim()}” as other medicine
                </button>
              )}
            </div>
          )}

          {draft.drug === 'custom' && (
            <label className="mt-3 block text-label text-fg-muted">
              Formulation
              <input value={draft.customFormulation}
                onChange={(event) => {
                  setDraft({ ...draft, customFormulation: event.target.value, customMedicationId: undefined });
                  setConfirmedProduct(false);
                  setConfirmedDirections(false);
                }}
                className={inputClass} placeholder="e.g. Immediate-release tablet" />
            </label>
          )}
          {draft.drug && isCatalogDrug(draft.drug) && (
            <>
              <p className="mt-2 text-caption text-fg-muted">
                Built-in: {DRUG_CATALOG[draft.drug].generic} · {DRUG_CATALOG[draft.drug].formulation}
              </p>
              {doseHelperCaption(draft.drug) && (
                <p className="mt-1 text-caption text-fg-muted">{doseHelperCaption(draft.drug)}</p>
              )}
            </>
          )}

          {draft.requiresManualDirections && (
            <p className="mt-4 text-label text-warn">
              These directions contain qualifiers, conflicts, or unsupported patterns. Preserve them as reviewed free text; add a structured schedule separately.
            </p>
          )}
          <div className="mt-4 flex gap-2" aria-label="Prescription type">
            {(['scheduled', 'prn', 'freeText'] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={draft.mode === mode}
                disabled={Boolean(draft.requiresManualDirections && mode !== 'freeText')}
                onClick={() => {
                  setDraft({ ...draft, mode });
                  setConfirmedDirections(false);
                }}
                className="rounded-sm border border-line px-3 py-2 text-label text-fg disabled:opacity-40">
                {mode === 'scheduled' ? 'Scheduled' : mode === 'prn' ? 'When needed' : 'Free text'}
              </button>
            ))}
          </div>

          {draft.mode === 'scheduled' ? (
            <div className="mt-3 space-y-2">
              {draft.rows.map((row, index) => (
                <div key={index} className="flex gap-2">
                  <input type="time" aria-label={`Dose ${index + 1} time`} value={row.time}
                    onChange={(event) => updateRow(index, 'time', event.target.value)}
                    className="rounded-sm border border-line bg-bg px-3 py-2 text-body" />
                  <input type="text" inputMode="decimal" aria-label={`Dose ${index + 1} mg`}
                    placeholder="Dose (mg)" value={row.dose}
                    onChange={(event) => updateRow(index, 'dose', event.target.value)}
                    className="w-32 rounded-sm border border-line bg-bg px-3 py-2 text-body" />
                  {draft.rows.length > 1 && (
                    <button type="button" className={secondaryClass} onClick={() => {
                      setDraft({ ...draft, rows: draft.rows.filter((_, rowIndex) => rowIndex !== index) });
                      setConfirmedDirections(false);
                    }}>Remove</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => {
                setDraft({ ...draft, rows: [...draft.rows, { time: '', dose: '' }] });
                setConfirmedDirections(false);
              }} className={secondaryClass}>Add time</button>
            </div>
          ) : draft.mode === 'prn' ? (
            <div className="mt-3 space-y-3">
              <label className="block text-label text-fg-muted">Dose per use (mg)
                <input value={draft.prnDose} inputMode="decimal"
                  onChange={(event) => {
                    setDraft({ ...draft, prnDose: event.target.value });
                    setConfirmedDirections(false);
                  }} className={inputClass} />
              </label>
              <label className="block text-label text-fg-muted">Condition for taking it
                <input value={draft.indication}
                  onChange={(event) => {
                    setDraft({ ...draft, indication: event.target.value });
                    setConfirmedDirections(false);
                  }} className={inputClass} />
              </label>
              <label className="block text-label text-fg-muted">Prescriber instructions — spacing, maximum amount, duration
                <textarea rows={4} value={draft.instructions}
                  onChange={(event) => {
                    setDraft({ ...draft, instructions: event.target.value });
                    setConfirmedDirections(false);
                  }} className={inputClass} />
              </label>
            </div>
          ) : (
            <label className="mt-3 block text-label text-fg-muted">Reviewed prescription directions
              <textarea rows={5} value={draft.instructions}
                onChange={(event) => {
                  setDraft({ ...draft, instructions: event.target.value });
                  setConfirmedDirections(false);
                }} className={inputClass} />
            </label>
          )}

          <div className="mt-4 space-y-2">
            <label className="flex gap-2 text-label"><input type="checkbox" checked={confirmedIdentity}
              onChange={(event) => setConfirmedIdentity(event.target.checked)} />I confirmed the medicine identity against the photo.</label>
            <label className="flex gap-2 text-label"><input type="checkbox" checked={confirmedProduct}
              onChange={(event) => setConfirmedProduct(event.target.checked)} />I confirmed the formulation and product details.</label>
            <label className="flex gap-2 text-label"><input type="checkbox" checked={confirmedDirections}
              onChange={(event) => setConfirmedDirections(event.target.checked)} />I confirmed every dose, time, and when-needed direction.</label>
          </div>
          <div className="mt-4 flex gap-4">
            <button type="button" onClick={addReviewedMedicine} className={primaryClass}>Add to reviewed list</button>
            <button type="button" onClick={() => { setCandidate(null); setDraft(null); }} className={secondaryClass}>
              Back to lines
            </button>
          </div>
        </div>
      )}

      </fieldset>

      {reviewed.length > 0 && !applied && (
        <div className="mt-5 border-t border-line pt-4">
          <h2 className="text-body font-medium">3. Reviewed medicines ({reviewed.length})</h2>
          <ul className="mt-2 space-y-2">
            {reviewed.map((entry) => (
              <li key={entry.item.id} className="flex items-center justify-between gap-3 rounded-sm border border-line bg-bg p-2 text-body">
                <span>
                  <span className="block">
                    {isCatalogDrug(entry.item.drug)
                      ? `${DRUG_CATALOG[entry.item.drug].generic} (${DRUG_CATALOG[entry.item.drug].formulation})`
                      : `${entry.item.customName} (${entry.item.customFormulation})`}
                  </span>
                  <span className="block text-caption text-fg-muted">
                    {entry.item.prn
                      ? `When needed: ${entry.item.prn.doseMg} mg — ${entry.item.prn.indication}${entry.item.prn.instructions ? ` — ${entry.item.prn.instructions}` : ''}`
                      : entry.item.freeText
                        ? `Free text: ${entry.item.freeText}`
                        : entry.item.times.map((dose) => `${dose.time} — ${dose.doseMg} mg`).join(', ')}
                  </span>
                </span>
                <button type="button" disabled={applyLocked} className={secondaryClass} onClick={() => {
                  const remaining = reviewed.filter((candidateEntry) => candidateEntry.item.id !== entry.item.id);
                  setReviewed(remaining);
                  setUsedLineIds(new Set(remaining.flatMap((candidateEntry) => candidateEntry.sourceLineIds)));
                }}>Remove</button>
              </li>
            ))}
          </ul>
          <button type="button" disabled={busy} onClick={() => void applyAll()} className={`mt-3 ${primaryClass}`}>
            Add {reviewed.length} reviewed medicine{reviewed.length === 1 ? '' : 's'}
          </button>
        </div>
      )}

      {message && <p role="status" className="mt-4 text-label text-warn">{message}</p>}
      <button type="button" disabled={applying}
        onClick={() => { if (!applying) { clearExtraction(); onBack(); } }}
        className={`mt-6 ${secondaryClass}`}>
        {applied ? 'Back to regimen' : 'Cancel'}
      </button>
    </section>
  );
}
