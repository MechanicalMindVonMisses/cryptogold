"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { InlineError } from "./primitives";

interface Props {
  children: ReactNode;
  /** Short name of the region, used in the fallback message. */
  label: string;
  className?: string;
}

interface State {
  error: Error | null;
}

/** Keeps a failing region from blanking the page; the rest of the dashboard stays usable. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[auratio] ${this.props.label} crashed`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className={this.props.className}>
          <InlineError
            message={`The ${this.props.label} could not be displayed.`}
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
