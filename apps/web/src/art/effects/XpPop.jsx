import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import styles from "./effects.module.css";

/**
 * "+30 XP" rising out of the result, once. Visual only: the XP toast announces the same thing as text.
 *
 * @param {{ xp: number }} props
 */
export function XpPop({ xp }) {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) {
    return null;
  }
  return (
    <span className={styles.xpPop} aria-hidden="true" data-effect="xp-pop">
      +{xp} XP
    </span>
  );
}
