import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { createTask } from './db/task';

// Brief §5.2 — single text input. Enter saves and clears. Esc clears
// without saving (per CLAUDE.md keyboard-shortcut note). No category, no
// priority, no confirmation toast. The input clearing IS the confirmation.
//
// We deliberately do NOT autoFocus on mount: the brief's premise is that
// the app is for play that doesn't justify itself, and pulling focus to the
// task field would nudge toward task-thinking. Let the user choose to tap.
export function Capture() {
  const [value, setValue] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const created = await createTask(value);
    if (created) setValue('');
    // If the trimmed title was empty, do nothing — leave whatever's in the
    // field so the user can keep typing or hit Esc.
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setValue('');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What's on your mind?"
        aria-label="Capture a task"
        // Underline-only field — no boxed input chrome, in keeping with the
        // calm/spare brief. Border darkens slightly on focus.
        className="w-full bg-transparent border-b border-neutral-200 px-1 py-2 text-base text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-400"
        autoComplete="off"
        // No autoCorrect: the brief expects voice-dictation artifacts and
        // mid-sentence language switches; mobile autocorrect would mangle them.
        autoCorrect="off"
        spellCheck={false}
      />
    </form>
  );
}
