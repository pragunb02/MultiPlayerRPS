import { Link } from "react-router";
import { paths } from "../../app/paths.js";
import { LogoMark } from "../../art/Logo.jsx";
import styles from "./SiteFooter.module.css";

/**
 * The foot of every page: the legal pages and the cookie notice (CC-046).
 *
 * The notice is a line of text, not a banner. ClassiCade sets one cookie, only once you choose to play, and only
 * to remember who you are, so there is nothing to agree to. A banner that can be closed would need its own cookie
 * or browser storage just to remember that it was closed, which is exactly what this notice promises we do not do.
 */
export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <p className={styles.tagline}>
        <LogoMark className={styles.mark} />
        <span>Play the classics with anyone, anywhere.</span>
      </p>
      <p className={styles.cookies}>
        One cookie keeps you signed in. No ads, no trackers.{" "}
        <Link to={paths.privacy()}>How we use your data</Link>
      </p>
      <nav aria-label="Legal" className={styles.links}>
        <Link to={paths.privacy()}>Privacy</Link>
        <Link to={paths.terms()}>Terms</Link>
      </nav>
    </footer>
  );
}
