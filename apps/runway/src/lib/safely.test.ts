import { describe, expect, it, vi } from 'vitest';
import { safely } from './safely';

describe('safely', () => {
  it('returns the computed value when compute succeeds', () => {
    const onError = vi.fn();
    expect(safely(() => 42, 0, 'answer', onError)).toBe(42);
    expect(onError).not.toHaveBeenCalled();
  });

  it('returns the fallback when compute throws', () => {
    const onError = vi.fn();
    const result = safely<number>(
      () => {
        throw new Error('boom');
      },
      -1,
      'answer',
      onError,
    );
    expect(result).toBe(-1);
  });

  it('calls onError with the label and the thrown error when compute throws', () => {
    const onError = vi.fn();
    const err = new Error('boom');
    safely<null>(
      () => {
        throw err;
      },
      null,
      'guess bias',
      onError,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('guess bias', err);
  });

  it('does not call onError when compute succeeds, even with a non-null fallback', () => {
    const onError = vi.fn();
    safely(() => 'ok', 'fallback', 'label', onError);
    expect(onError).not.toHaveBeenCalled();
  });
});
