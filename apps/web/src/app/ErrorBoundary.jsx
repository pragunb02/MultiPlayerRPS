import { Component } from "react";
import styles from "./ErrorBoundary.module.css";

/**
 * Last line of defence for rendering errors: shows a friendly message instead of a blank page.
 * (Error reporting hooks in with observability, CC-049.) `onError` is told the error, for usage counts (CC-174).
 *
 * @extends {Component<{ onError?: (error: unknown) => void, children?: import("react").ReactNode }>}
 */
export class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    try {
      this.props.onError?.(error);
    } catch {
      // Counting must never stop the error page from showing.
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className={styles.failed}>
          <h1>Something went wrong</h1>
          <p>Please reload the page.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
