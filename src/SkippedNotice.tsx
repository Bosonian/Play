// Brief §5.4 / §9 step 8. One-liner observation when the user has actively
// skipped reflection three Sundays in a row. Verbatim copy from the brief —
// "That's data — not a problem" framing is non-negotiable, do not soften.
// No nag, no prompt, no dismiss button. Just the observation.
export function SkippedNotice({ count }: { count: number }) {
  if (count < 3) return null;
  return (
    <p className="mb-8 text-xs italic text-ink-mute">
      You&apos;ve skipped reflection three Sundays running. That&apos;s data — not a
      problem.
    </p>
  );
}
