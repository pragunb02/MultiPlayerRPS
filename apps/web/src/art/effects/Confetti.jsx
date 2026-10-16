import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import styles from "./effects.module.css";

export const CONFETTI_PIECES = 24;

/**
 * A burst of confetti over the page, once. Purely visual: it never takes clicks, screen readers skip it, and
 * with reduced motion it isn't there at all — the win itself is announced as text elsewhere.
 */
export function Confetti() {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) {
    return null;
  }
  return (
    <div className={styles.overlay} aria-hidden="true" data-effect="confetti">
      {Array.from({ length: CONFETTI_PIECES }, (_, index) => (
        <span key={index} className={styles.piece} />
      ))}
    </div>
  );
}
