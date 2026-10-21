import { Button } from "../Button/Button.jsx";
import { SKELETON_SHAPES } from "../looks.js";
import styles from "./States.module.css";

/**
 * A region with nothing to show yet, or a dead end (CC-259, CC-323): art, what this is in one line, and one way on.
 * The art is decoration, so it is hidden from screen readers and the meaning is in the words.
 *
 * @param {{
 *   title: import("react").ReactNode,
 *   art?: import("react").ReactNode,
 *   headingLevel?: 1 | 2 | 3,
 *   action?: import("react").ReactNode,
 *   secondary?: import("react").ReactNode,
 *   className?: string,
 *   children?: import("react").ReactNode,
 * }} props  `children`: the one line under the title. `action`: the one button, usually a primary. `secondary`:
 *   a quieter way on, such as a ghost link back
 */
export function EmptyState({ title, art, headingLevel = 2, action, secondary, className = "", children }) {
  const Heading = `h${headingLevel}`;
  return (
    <div className={`${styles.empty} ${className}`} data-cc-state="empty">
      {art !== undefined && (
        <div className={styles.art} aria-hidden="true">
          {art}
        </div>
      )}
      <Heading className={headingLevel === 1 ? styles.pageTitle : styles.title}>{title}</Heading>
      {children !== undefined && <p className={styles.line}>{children}</p>}
      {(action !== undefined || secondary !== undefined) && (
        <div className={styles.actions}>
          {action}
          {secondary}
        </div>
      )}
    </div>
  );
}

/**
 * Something could not be loaded (CC-323). It says what failed in plain words and, when trying again can help,
 * offers Retry. It is an alert, so a screen reader reads it as soon as it shows.
 *
 * @param {{
 *   title: import("react").ReactNode,
 *   control: string,
 *   onRetry?: () => void,
 *   className?: string,
 *   children?: import("react").ReactNode,
 * }} props  `control`: the Retry button's control name. `children`: what the player can do about it, one line
 */
export function ErrorState({ title, control, onRetry, className = "", children }) {
  return (
    <div className={`${styles.error} ${className}`} role="alert" data-cc-state="error">
      <p className={styles.errorTitle}>
        <span className={styles.errorMark} aria-hidden="true">
          !
        </span>
        {title}
      </p>
      {children !== undefined && <p className={styles.line}>{children}</p>}
      {onRetry !== undefined && (
        <div className={styles.actions}>
          <Button control={`${control}.retry`} variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The shape of what is loading, in place of a bare "Loading…" line (CC-282, CC-323). It takes the room the real
 * content will take, so nothing below it jumps when the content comes. A screen reader hears `label` once, as a
 * status, and the shapes themselves are hidden from it. Under reduced motion the shimmer stops.
 *
 * @param {{
 *   label: string,
 *   shape?: "line" | "row" | "tile" | "card" | "board" | "block",
 *   count?: number,
 *   className?: string,
 * }} props  `label`: what is loading, such as "Loading the leaderboard". `count`: how many shapes, such as one
 *   per row of a table
 */
export function Skeleton({ label, shape = "line", count = 1, className = "" }) {
  if (!SKELETON_SHAPES.includes(shape))
    throw new Error(`Skeleton shape "${shape}" is not one of ${SKELETON_SHAPES}`);
  return (
    <div
      className={`${styles.skeleton} ${styles[`${shape}s`]} ${className}`}
      role="status"
      aria-busy="true"
      data-cc-state="loading"
    >
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={`${styles.bone} ${styles[shape]}`} aria-hidden="true" />
      ))}
    </div>
  );
}
