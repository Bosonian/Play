import { Component, type ReactNode } from 'react';
import { logEvent } from '../lib/eventLog';
import { Button } from './Button';

/** Kept low enough that a logged "Screen error: ..." line stays a single
 * short entry in the activity log's one-line-per-event shape
 * (eventLog.ts's own header comment: "what did the app DO", not a crash
 * dump) — an uncaught exception's `message` can be arbitrarily long (a
 * stack-trace-shaped string from a third-party library, or a non-Error
 * value some code threw), and this is the bound that keeps the log
 * readable regardless of what actually threw. */
const MESSAGE_MAX_CHARS = 120;

/**
 * Truncates an error's message for the activity log, ellipsis-marked so a
 * cut message always reads as "there was more", never as the error's
 * complete text. Pure and exported so it's unit-testable without having to
 * throw a real Error through a rendered component — this app has no
 * jsdom/RTL precedent (ErrorBoundary.tsx's own header comment), so the
 * boundary's actual catch behaviour stays verified by reading rather than
 * a render test, and this is the one piece of real logic small and pure
 * enough to earn its own test regardless.
 */
export function truncateErrorMessage(message: string, maxChars: number = MESSAGE_MAX_CHARS): string {
  if (message.length <= maxChars) return message;
  return `${message.slice(0, maxChars)}…`;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Called once, from the recovery button. App.tsx passes a
   * navigate-home callback (`() => setScreen({ name: 'home' })`) rather
   * than this component knowing anything about `Screen`/navigation
   * itself — keeps this boundary generic and reusable, not wired to one
   * app's routing shape. */
  onReset: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Field report #16, verbatim: "What runway has learned button leads to a
 * blank page." A blank page in a Capacitor WebView IS an uncaught
 * exception thrown during React render — with no error boundary anywhere
 * in this app before this file (grep confirmed none), React unmounts the
 * whole tree on any render-time throw and the WebView just shows nothing,
 * with no on-device trail of what happened. This is App.tsx's one
 * boundary, wrapping every screen's render (see App.tsx's `renderScreen`
 * call site) — it doesn't fix whatever screen-specific bug causes a given
 * throw (that still needs its own diagnosis, same as this field report's
 * own Part A investigation), but it turns every FUTURE render crash from
 * "silent white screen, no trail" into "a calm, recoverable message, plus
 * a logged event to read afterward" — exactly the gap this field report
 * exposed.
 *
 * Class component because React 18 (this app's version) has no hook-based
 * equivalent — `getDerivedStateFromError`/`componentDidCatch` are still
 * class-only lifecycle methods; this is the one place in the app that has
 * to be a class rather than a function component for that reason alone.
 *
 * `key`-remountable by design: App.tsx already remounts its screen wrapper
 * on every navigation via `key={screen.name}` (the UI-polish fade-in
 * increment) — wrapping THAT wrapper in this boundary means a fresh
 * navigation after a crash gets a fresh ErrorBoundary instance for free,
 * with no separate reset wiring needed beyond the recovery button's own
 * `onReset` call for the "stay on this broken screen, but let me leave"
 * case.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Fire-and-forget, same contract as every other logEvent call site
    // (eventLog.ts's own doc comment): a logging failure must never be the
    // reason recovery itself fails or even pauses.
    void logEvent('lifecycle', `Screen error: ${truncateErrorMessage(error.message)}.`);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
    this.props.onReset();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 pt-safe-top text-center">
          <h1 className="text-xl font-semibold text-slate-100">Something broke on this screen.</h1>
          <p className="text-sm text-slate-400">The error is saved to the activity log. Tap to go home.</p>
          <Button onClick={this.handleReset}>Go home</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
