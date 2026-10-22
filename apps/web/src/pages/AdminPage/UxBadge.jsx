import { COLOUR_WORDS } from "./uxText.js";
import styles from "./UxBadge.module.css";

/**
 * A budget colour as a badge: its word on the colour's pale background, with a dot. Status roles only (CONTRACT.md
 * section 1): green is `success`, amber `warning`, red `danger`, none muted. Never the colour alone.
 *
 * @param {{ colour: string, context?: string }} props  `context`: words a screen reader hears after the colour, such
 *   as "last week's budget"
 */
export function ColourBadge({ colour, context }) {
  const word = COLOUR_WORDS[colour] ?? COLOUR_WORDS.none;
  return (
    <span className={`${styles.badge} ${styles[colour] ?? styles.none}`} data-colour={colour}>
      <span className={styles.dot} aria-hidden="true" />
      {word}
      {context !== undefined && <span className="visually-hidden">, {context}</span>}
    </span>
  );
}
