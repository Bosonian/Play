import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetBackOverridesForTest, consumeBackOverride, pushBackOverride } from './backOverride';

// Module-level state (see backOverride.ts's own doc comment on why) means
// tests must not leak into each other — every test starts from an empty
// stack, whether or not the test itself remembered to unregister.
afterEach(() => {
  _resetBackOverridesForTest();
});

describe('consumeBackOverride', () => {
  it('returns false and does nothing when the stack is empty', () => {
    expect(consumeBackOverride()).toBe(false);
  });

  it('calls the registered handler and returns true', () => {
    const handler = vi.fn();
    pushBackOverride(handler);
    expect(consumeBackOverride()).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('calls only the TOP-most (most recently pushed) handler, not earlier ones', () => {
    const first = vi.fn();
    const second = vi.fn();
    pushBackOverride(first);
    pushBackOverride(second);
    consumeBackOverride();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('does not auto-unregister — a second gesture consumes the same top handler again', () => {
    const handler = vi.fn();
    pushBackOverride(handler);
    consumeBackOverride();
    consumeBackOverride();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('pushBackOverride unregister', () => {
  it('removes the handler so a later consume falls through to false once the stack is empty', () => {
    const handler = vi.fn();
    const unregister = pushBackOverride(handler);
    unregister();
    expect(consumeBackOverride()).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('removes THAT handler by identity even when others were pushed after it (filter, not pop)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = pushBackOverride(first);
    pushBackOverride(second);

    // Unregistering the OLDER override while a newer one is still on top —
    // a blind pop() here would wrongly remove `second` instead.
    unregisterFirst();

    expect(consumeBackOverride()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('unregistering the top handler reveals the next one underneath', () => {
    const first = vi.fn();
    const second = vi.fn();
    pushBackOverride(first);
    const unregisterSecond = pushBackOverride(second);

    unregisterSecond();

    expect(consumeBackOverride()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('is safe to call twice (idempotent no-op the second time)', () => {
    const handler = vi.fn();
    const unregister = pushBackOverride(handler);
    unregister();
    expect(() => unregister()).not.toThrow();
    expect(consumeBackOverride()).toBe(false);
  });
});
