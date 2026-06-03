"use client";

import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Can be a ReactNode (static) or a function receiving a reset callback */
  fallback?: ReactNode | ((reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: any) => void;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === "function") {
        return (this.props.fallback as (reset: () => void) => ReactNode)(
          this.handleReset
        );
      }
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="error-boundary-fallback" role="alert">
          <div className="error-boundary-icon">⚠</div>
          <h3 className="error-boundary-title">Something went wrong</h3>
          <p className="error-boundary-message">
            {this.state.error?.message ||
              "An unexpected error occurred in this panel."}
          </p>
          <button className="error-boundary-retry" onClick={this.handleReset}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
