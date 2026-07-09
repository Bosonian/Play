import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { format } from 'date-fns';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const TIMEOUT_MS = 20_000;

export interface CaptureDraft {
  name: string;
  destination: string;
  date: string;
  time: string;
}

/**
 * Builds the full generateContent request body for one dictated sentence.
 * Pure and exported on its own so the prompt itself (the part most likely
 * to need tuning after seeing real dictated input) can be unit tested
 * without any network mocking — see geminiApi.test.ts.
 *
 * Judgment call: the preamble states today's date as the fallback when the
 * sentence names no date at all ("Zahnarzt 14:30", no day). The brief only
 * specifies how *relative* day names resolve (forward from now); an
 * undated appointment defaulting to today is the same "least surprising
 * guess" DepartureSetup's own blank-form default already makes (see its
 * comment on `appointmentDate`), so this mirrors that rather than
 * inventing new behaviour.
 */
export function buildCaptureRequest(text: string, now: Date): object {
  // 'xxx' (date-fns) renders the UTC offset as "+02:00" / "-05:00" — the
  // same shape ISO 8601 itself uses, which is the one Gemini is least
  // likely to misread regardless of what language surrounds it in the
  // prompt.
  const localDateTime = format(now, "yyyy-MM-dd'T'HH:mm");
  const weekday = format(now, 'EEEE');
  const utcOffset = format(now, 'xxx');

  const prompt = `You convert one dictated sentence into a draft calendar-style departure entry for a personal planning app.

Current local date and time: ${localDateTime} (${weekday}), UTC offset ${utcOffset}.

The sentence was produced by voice dictation and may mix German and English — and occasionally other languages — within the same sentence (for example "Zahnarzt Donnerstag 14:30 in Ludwigsburg" or "dentist next Thursday at half two in Ludwigsburg"). Read across languages freely; do not ask for clarification, just make the best reading.

Extract the following fields as JSON:
- name: what the appointment is for, kept short and in whichever language it was said (e.g. "Zahnarzt", "Dentist").
- destination: the place mentioned, if any. Use an empty string if no place was said.
- date: the appointment date as YYYY-MM-DD. Relative day references ("Donnerstag", "Thursday", "morgen", "übermorgen") resolve FORWARD from the current date above — the NEXT occurrence of that day, never one already in the past. If the sentence names no date at all, use today's date above.
- time: the appointment time as 24-hour HH:mm. If NO time was stated in the sentence, leave this as an empty string — do not guess or default to a time. Inventing a time that was never said is worse than leaving it blank; the app will ask the person to confirm it by hand.

Sentence: "${text}"`;

  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      // OpenAPI-subset schema, the shape the Gemini API's `responseSchema`
      // field expects (types are the uppercase Type-enum spellings the API
      // uses in its REST JSON representation, e.g. "STRING"/"OBJECT" — not
      // JSON Schema's lowercase "string"/"object"). All four fields are
      // required so the model always returns a complete, parseable shape;
      // "no time heard" is expressed by an empty string value, not by
      // omitting the field.
      responseSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          destination: { type: 'STRING' },
          date: { type: 'STRING' },
          time: { type: 'STRING' },
        },
        required: ['name', 'destination', 'date', 'time'],
      },
    },
  };
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_SHAPE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Extracts and shape-checks a CaptureDraft from a raw generateContent
 * response, defensively — same reasoning as routesApi.ts's
 * parseRouteDurationSeconds: the response shape is outside this app's
 * control (a model hiccup, a safety-filter block, a future API change),
 * so every step here is a type guard, not an assumption, and any mismatch
 * anywhere in the chain returns null rather than throwing. The model's
 * actual answer arrives nested at candidates[0].content.parts[0].text —
 * and, per the generateContent contract, that text is itself a JSON
 * *string* (not an already-parsed object) because it round-trips through
 * a single text part like any other model output, `responseMimeType:
 * 'application/json'` only constrains what that string contains.
 */
export function parseCaptureResponse(response: unknown): CaptureDraft | null {
  if (typeof response !== 'object' || response === null) return null;

  const candidates = (response as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const firstCandidate = candidates[0];
  if (typeof firstCandidate !== 'object' || firstCandidate === null) return null;

  const content = (firstCandidate as Record<string, unknown>).content;
  if (typeof content !== 'object' || content === null) return null;

  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;

  const firstPart = parts[0];
  if (typeof firstPart !== 'object' || firstPart === null) return null;

  const text = (firstPart as Record<string, unknown>).text;
  if (typeof text !== 'string') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const draft = parsed as Record<string, unknown>;

  const { name, destination, date, time } = draft;
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (typeof destination !== 'string') return null;
  if (typeof date !== 'string' || !DATE_SHAPE.test(date)) return null;
  // Empty time is a valid, expected outcome (see buildCaptureRequest's
  // "never invent one" instruction) — only a NON-empty value has to match
  // the HH:mm shape.
  if (typeof time !== 'string' || (time !== '' && !TIME_SHAPE.test(time))) return null;

  return { name, destination, date, time };
}

export type CaptureResult = { ok: true; draft: CaptureDraft } | { ok: false; reason: string };

/**
 * Calls Gemini for one dictated sentence and returns a draft departure.
 * Never throws — mirrors fetchDriveMinutes' (routesApi.ts) never-throws
 * result pattern exactly, for the same reason: Home's capture box treats
 * "parsing failed" as an ordinary outcome to show inline, not an
 * exception to wrap in a try/catch of its own.
 */
export async function captureDeparture(text: string, now: Date, apiKey: string): Promise<CaptureResult> {
  const body = buildCaptureRequest(text, now);
  const headers = {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  };

  try {
    const data = await requestGemini(body, headers);
    const draft = parseCaptureResponse(data);
    if (draft === null) {
      return { ok: false, reason: 'Unexpected response shape from the Gemini API.' };
    }
    return { ok: true, draft };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Gemini API request failed.' };
  }
}

/**
 * The actual network call, split out of captureDeparture the same way
 * requestRoutes is split out of fetchDriveMinutes (routesApi.ts) — one
 * clearly-scoped branch per transport instead of an if/else threaded
 * through the parsing logic above. See requestRoutes' own comment for why
 * CapacitorHttp is required on native (WebView CORS) and plain fetch is
 * fine on web/dev.
 */
async function requestGemini(body: unknown, headers: Record<string, string>): Promise<unknown> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url: GEMINI_API_URL,
      headers,
      data: body,
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(geminiErrorMessage(response.status, response.data));
    }
    return response.data;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Best-effort: Gemini's own error body (`{error: {message, ...}}`)
      // is far more useful than a bare status code when it's present, but
      // a non-2xx response isn't guaranteed to have a JSON body at all
      // (a proxy 502, for instance), so a parse failure here falls back
      // to the status alone rather than throwing a second, unrelated error.
      let errorData: unknown = null;
      try {
        errorData = await response.json();
      } catch {
        // No JSON body — geminiErrorMessage below falls back to the status.
      }
      throw new Error(geminiErrorMessage(response.status, errorData));
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function geminiErrorMessage(status: number, data: unknown): string {
  const apiMessage = extractApiErrorMessage(data);
  return apiMessage ? `Gemini API returned status ${status}: ${apiMessage}` : `Gemini API returned status ${status}.`;
}

function extractApiErrorMessage(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const error = (data as Record<string, unknown>).error;
  if (typeof error !== 'object' || error === null) return null;
  const message = (error as Record<string, unknown>).message;
  return typeof message === 'string' ? message : null;
}
