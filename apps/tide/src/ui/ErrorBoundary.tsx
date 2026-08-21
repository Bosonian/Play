// Adapted from apps/runway/src/ui/ErrorBoundary.tsx (field report #16's
// "blank screen" lesson: an uncaught render-time throw unmounts the whole
// React tree with no on-device trail — this boundary turns that into a
// calm, recoverable message). Increment 1 shipped this with `onError`
// undefined, falling back to `console.warn` because the activity-log table
// didn't exist yet. Increment 2 fulfills that: App.tsx now passes
// `onError={(message) => void logEvent('lifecycle', message)}`, so a caught
// screen error is a real, on-device, persisted line — see eventLog.ts.
import { Component, type ReactNode } from 'react';
import { Button } from './Button';

/** Same bound as Runway's, kept here even though nothing logs yet — once
 * `onError` is wired to a real event log, a call site shouldn't have to
 * remember to add this back. */
const MESSAGE_MAX_CHARS = 120;

/** Truncates an error's message, ellipsis-marked so a cut message always
 * reads as "there was more". Pure and exported for the same reason
 * Runway's twin is: unit-testable without rendering a real crash. */
export function truncateErrorMessage(message: string, maxChars: number = MESSAGE_MAX_CHARS): string {
  if (message.length <= maxChars) return message;
  return `${message.slice(0, maxChars)}…`;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Called once, from the recovery button. App.tsx passes a
   * navigate-home callback, keeping this boundary generic and reusable
   * rather than wired to one app's routing shape. */
  onReset: () => void;
  /**
   * Optional hook for the caught error, called from componentDidCatch.
   * Defaults to `console.warn` (see this file's header comment for why —
   * increment 2's activity log is the intended real implementation).
   * Exposed as a prop, not hard-coded, so App.tsx can swap it for a real
   * logger later without touching this component.
   */
  onError?: (message: string) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * App.tsx's one boundary, wrapping every screen's render. Class component
 * because React 18 has no hook-based equivalent —
 * `getDerivedStateFromError`/`componentDidCatch` are still class-only
 * lifecycle methods.
 *
 * `key`-remountable by design: App.tsx remounts its screen wrapper on every
 * navigation via `key={screen.name}`, so a fresh navigation after a crash
 * gets a fresh ErrorBoundary instance for free.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    const message = `Screen error: ${truncateErrorMessage(error.message)}.`;
    if (this.props.onError) {
      this.props.onError(message);
    } else {
      // eslint-disable-next-line no-console -- see header comment: this is
      // the placeholder until increment 2's activity log exists.
      console.warn(message);
    }
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
          <p className="text-sm text-slate-400">Tap to go home.</p>
          <Button onClick={this.handleReset}>Go home</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
