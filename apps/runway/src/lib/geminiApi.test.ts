import { format } from 'date-fns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCaptureRequest, captureDeparture, parseCaptureResponse } from './geminiApi';

describe('buildCaptureRequest', () => {
  // A fixed instant, not a fixed local-clock reading — buildCaptureRequest
  // formats `now` in the machine's own local timezone (correct behaviour
  // for a real phone, which really is in Stuttgart's), so the expected
  // datetime/weekday/offset strings below are derived with the same
  // date-fns `format` calls rather than hard-coded, the same
  // timezone-independence trick widgetSnapshot.test.ts's localMidnightMs
  // comment describes.
  const now = new Date('2026-07-09T08:30:00.000Z');

  it('targets the gemini-2.0-flash generateContent endpoint shape with a single user content', () => {
    const body = buildCaptureRequest('Zahnarzt Donnerstag 14:30 in Ludwigsburg', now) as {
      contents: { role: string; parts: { text: string }[] }[];
    };
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts).toHaveLength(1);
    expect(typeof body.contents[0].parts[0].text).toBe('string');
  });

  it('embeds the current local datetime, ISO weekday, and UTC offset in the prompt', () => {
    const body = buildCaptureRequest('dentist tomorrow', now) as {
      contents: { parts: { text: string }[] }[];
    };
    const prompt = body.contents[0].parts[0].text;
    expect(prompt).toContain(format(now, "yyyy-MM-dd'T'HH:mm"));
    expect(prompt).toContain(format(now, 'EEEE'));
    expect(prompt).toContain(format(now, 'xxx'));
  });

  it('includes the dictated sentence verbatim', () => {
    const body = buildCaptureRequest('Zahnarzt Donnerstag 14:30 in Ludwigsburg', now) as {
      contents: { parts: { text: string }[] }[];
    };
    expect(body.contents[0].parts[0].text).toContain('Zahnarzt Donnerstag 14:30 in Ludwigsburg');
  });

  it('mentions mixed-language input so the model does not refuse or ask for clarification', () => {
    const body = buildCaptureRequest('x', now) as { contents: { parts: { text: string }[] }[] };
    const prompt = body.contents[0].parts[0].text.toLowerCase();
    expect(prompt).toContain('german');
    expect(prompt).toContain('english');
  });

  it('instructs that relative dates resolve forward and inventing a time is worse than a blank one', () => {
    const body = buildCaptureRequest('x', now) as { contents: { parts: { text: string }[] }[] };
    const prompt = body.contents[0].parts[0].text.toLowerCase();
    expect(prompt).toContain('forward');
    expect(prompt).toContain('worse than leaving it blank');
  });

  it('sets responseMimeType to application/json with a schema requiring all four fields', () => {
    const body = buildCaptureRequest('x', now) as {
      generationConfig: { responseMimeType: string; responseSchema: { required: string[] } };
    };
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.required.sort()).toEqual(['date', 'destination', 'name', 'time']);
  });
});

describe('parseCaptureResponse', () => {
  function wrap(jsonText: string): unknown {
    return { candidates: [{ content: { parts: [{ text: jsonText }] } }] };
  }

  it('parses a well-formed happy-path response', () => {
    const response = wrap(JSON.stringify({ name: 'Zahnarzt', destination: 'Ludwigsburg', date: '2026-07-16', time: '14:30' }));
    expect(parseCaptureResponse(response)).toEqual({
      name: 'Zahnarzt',
      destination: 'Ludwigsburg',
      date: '2026-07-16',
      time: '14:30',
    });
  });

  it('returns null when candidates is missing', () => {
    expect(parseCaptureResponse({})).toBeNull();
  });

  it('returns null when candidates is empty', () => {
    expect(parseCaptureResponse({ candidates: [] })).toBeNull();
  });

  it("returns null when the inner text isn't valid JSON", () => {
    expect(parseCaptureResponse(wrap('not json'))).toBeNull();
  });

  it('returns null for a malformed date shape', () => {
    const response = wrap(JSON.stringify({ name: 'Zahnarzt', destination: '', date: '16-07-2026', time: '14:30' }));
    expect(parseCaptureResponse(response)).toBeNull();
  });

  it('returns null for a malformed time shape', () => {
    const response = wrap(JSON.stringify({ name: 'Zahnarzt', destination: '', date: '2026-07-16', time: '2:30pm' }));
    expect(parseCaptureResponse(response)).toBeNull();
  });

  it('accepts an empty time string as valid ("no time heard")', () => {
    const response = wrap(JSON.stringify({ name: 'Zahnarzt', destination: '', date: '2026-07-16', time: '' }));
    expect(parseCaptureResponse(response)).toEqual({ name: 'Zahnarzt', destination: '', date: '2026-07-16', time: '' });
  });

  it('ignores extra fields the model might add', () => {
    const response = wrap(
      JSON.stringify({ name: 'Zahnarzt', destination: '', date: '2026-07-16', time: '14:30', confidence: 0.9 }),
    );
    expect(parseCaptureResponse(response)).toEqual({ name: 'Zahnarzt', destination: '', date: '2026-07-16', time: '14:30' });
  });

  it('is null-safe for non-object, null, and undefined input', () => {
    expect(parseCaptureResponse(null)).toBeNull();
    expect(parseCaptureResponse(undefined)).toBeNull();
    expect(parseCaptureResponse('nope')).toBeNull();
    expect(parseCaptureResponse(42)).toBeNull();
  });

  it('returns null when a required field is missing or the wrong type', () => {
    expect(parseCaptureResponse(wrap(JSON.stringify({ destination: '', date: '2026-07-16', time: '14:30' })))).toBeNull();
    expect(parseCaptureResponse(wrap(JSON.stringify({ name: 5, destination: '', date: '2026-07-16', time: '14:30' })))).toBeNull();
  });

  it('returns null when content/parts are missing or malformed', () => {
    expect(parseCaptureResponse({ candidates: [{}] })).toBeNull();
    expect(parseCaptureResponse({ candidates: [{ content: {} }] })).toBeNull();
    expect(parseCaptureResponse({ candidates: [{ content: { parts: [] } }] })).toBeNull();
    expect(parseCaptureResponse({ candidates: [{ content: { parts: [{ text: 42 }] } }] })).toBeNull();
  });
});

describe('captureDeparture', () => {
  const now = new Date('2026-07-09T08:30:00+02:00');

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed draft on success', async () => {
    const body = JSON.stringify({ name: 'Zahnarzt', destination: 'Ludwigsburg', date: '2026-07-16', time: '14:30' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: body }] } }] }), { status: 200 })),
    );

    const result = await captureDeparture('Zahnarzt Donnerstag 14:30 in Ludwigsburg', now, 'test-key');
    expect(result).toEqual({
      ok: true,
      draft: { name: 'Zahnarzt', destination: 'Ludwigsburg', date: '2026-07-16', time: '14:30' },
    });
  });

  it('sends the api key in the x-goog-api-key header', async () => {
    const body = JSON.stringify({ name: 'x', destination: '', date: '2026-07-16', time: '' });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: body }] } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await captureDeparture('x', now, 'test-key');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('test-key');
  });

  it('fails cleanly and includes the API error message on a non-2xx status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 })),
    );

    const result = await captureDeparture('x', now, 'bad-key');
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toContain('API key not valid.');
  });

  it('fails cleanly when the response body has an unexpected shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })));

    const result = await captureDeparture('x', now, 'test-key');
    expect(result.ok).toBe(false);
  });

  it('fails cleanly on a network error rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const result = await captureDeparture('x', now, 'test-key');
    expect(result).toEqual({ ok: false, reason: 'network down' });
  });
});
