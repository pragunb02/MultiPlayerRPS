import { Component } from "react";
import { Button } from "../components/Button/Button.jsx";
import { paths } from "./paths.js";
import styles from "./ErrorBoundary.module.css";

/**
 * Says that a page broke, and gives the two ways on: reload it, or go to the home page (CC-350, CL-01). Both load
 * the page again from the server instead of using the router, which may be what broke. The game itself lives on the
 * server, so nothing the player did is lost.
 *
 * @param {{ onReload: () => void, onHome: () => void }} props
 */
function Crashed({ onReload, onHome }) {
  return (
    <section role="alert" className={styles.failed}>
      <h1>This page broke</h1>
      <p>Something on this page stopped working. Your games and progress are safe.</p>
      <p>Reload the page to try again, or start again from the home page.</p>
      <div className={styles.actions}>
        <Button control="crash.reload" onClick={onReload}>
          Reload the page
        </Button>
        <Button control="crash.home" variant="secondary" onClick={onHome}>
          Back to home
        </Button>
      </div>
    </section>
  );
}

/**
 * Last line of defence for rendering errors: says what happened instead of a blank page. The layout puts one around
 * each page, so the header still works when a page breaks, and the app puts one around everything for a fault in the
 * header itself. A tab left open across a deploy reloads itself before this shows (staleBuild.js, CC-181).
 * (Error reporting hooks in with observability, CC-049.)
 *
 * @param {{
 *   resetKey?: string,
 *   onError?: (error: unknown) => void,
 *   onReload?: () => void,
 *   onHome?: () => void,
 *   children: import("react").ReactNode,
 * }} props
 *   `resetKey`: after a failure, a new value draws the children again, such as the address once the player follows
 *   a link in the header. A change while nothing failed does nothing, so a page is never drawn afresh for it.
 *   `onReload` and `onHome` are for tests. By default they reload the page and open the home page.
 *   `onError` is told the error, for usage counts (CC-174)
 */
export class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
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
      const {
        onReload = () => window.location.reload(),
        onHome = () => window.location.assign(paths.home()),
      } = this.props;
      return <Crashed onReload={onReload} onHome={onHome} />;
    }
    return this.props.children;
  }
}
