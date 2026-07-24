import { describe, expect, it } from 'vitest';
import { parseSharedDestination } from './shareTarget';

describe('parseSharedDestination', () => {
  it('extracts the place name from a Google Maps-style share', () => {
    expect(parseSharedDestination('Klinikum Stuttgart\nhttps://maps.app.goo.gl/xyz123')).toBe('Klinikum Stuttgart');
  });

  it('returns plain text unchanged when there is no URL at all', () => {
    expect(parseSharedDestination('Klinikum Stuttgart')).toBe('Klinikum Stuttgart');
  });

  it('strips a URL embedded mid-line, not just one on its own line', () => {
    expect(parseSharedDestination('Klinikum Stuttgart https://maps.app.goo.gl/xyz123 (Herzzentrum)')).toBe(
      'Klinikum Stuttgart (Herzzentrum)',
    );
  });

  it('skips leading blank lines to find the first non-empty one', () => {
    expect(parseSharedDestination('\n\nKlinikum Stuttgart\nhttps://maps.app.goo.gl/xyz123')).toBe('Klinikum Stuttgart');
  });

  it('returns an empty string when the text is only a URL', () => {
    expect(parseSharedDestination('https://maps.app.goo.gl/xyz123')).toBe('');
  });

  it('returns an empty string for entirely empty input', () => {
    expect(parseSharedDestination('')).toBe('');
  });

  it('collapses internal double spaces and tabs to a single space', () => {
    expect(parseSharedDestination('Klinikum   Stuttgart\t\tHerzzentrum')).toBe('Klinikum Stuttgart Herzzentrum');
  });

  it('strips a plain http (not just https) URL', () => {
    expect(parseSharedDestination('Klinikum Stuttgart\nhttp://maps.google.com/xyz')).toBe('Klinikum Stuttgart');
  });
});
