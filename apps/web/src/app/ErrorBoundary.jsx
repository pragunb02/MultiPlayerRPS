import { Component } from "react";
import styles from "./ErrorBoundary.module.css";

/**
 * Last line of defence for rendering errors: shows a friendly message instead of a blank page.
 * (Error reporting hooks in with observability, CC-049.)
 */
export class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
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
