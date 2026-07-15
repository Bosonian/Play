// A last-resort error boundary. Without this, any thrown render error unmounts
// the whole app to a white screen with no recovery — worst of all in a
// standalone PWA where there's no visible reload button (robustness audit P0).
// This converts a crash into a calm, recoverable panel.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[Head-in] render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto flex h-full max-w-md flex-col items-start justify-center gap-3 bg-bg px-6 text-fg">
          <h1 className="text-title font-semibold">Something broke.</h1>
          <p className="text-body text-fg-muted">
            The screen hit an error. Your saved progress is safe on this device.
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              location.reload();
            }}
            className="mt-2 rounded-md bg-accent px-5 py-3 text-body font-medium text-white"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
