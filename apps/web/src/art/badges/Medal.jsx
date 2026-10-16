import { Svg } from "../Svg.jsx";
import art from "../art.module.css";
import styles from "./Medal.module.css";

/**
 * A podium medal on a ribbon, in a tier colour (gold, silver, bronze for places 1–3). It has no number of its own:
 * the place is text laid over it, so lists keep their words. Decorative unless given a `title`.
 *
 * @param {{ tier?: "gold" | "silver" | "bronze", title?: string, className?: string }} props
 */
export function Medal({ tier = "gold", title = "", className = "" }) {
  return (
    <Svg viewBox="0 0 40 48" title={title} className={`${styles.medal} ${className}`}>
      <path d="M10 2 H18 L24 18 H16 Z" className={art.fPrimary} />
      <path d="M30 2 H22 L16 18 H24 Z" className={art.fAccent} />
      <circle cx="20" cy="30" r="16" className={art[tier]} />
      <circle
        cx="20"
        cy="30"
        r="12.5"
        className={`${art.fNone} ${art.sOnTier} ${art.faint}`}
        strokeWidth="1.5"
      />
    </Svg>
  );
}
