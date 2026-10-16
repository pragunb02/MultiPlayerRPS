import { Svg } from "../Svg.jsx";
import art from "../art.module.css";
import styles from "./LevelBadge.module.css";
import { rankForLevel } from "./ranks.js";

const OUTER = "M24 2 L44 13.5 V38.5 L24 50 L4 38.5 V13.5 Z";
const INNER = "M24 8 L39 16.75 V35.25 L24 44 L9 35.25 V16.75 Z";

/**
 * A hexagonal shield with the level number, coloured by rank tier (ranks.js). Meaningful by default — it is
 * named "<Rank> rank, level <n>" — or decorative with `decorative` when text next to it already says so.
 * `numbered={false}` draws the bare shield, for a row whose own text carries the number (so the row's text stays
 * exactly what it says).
 *
 * @param {{ level: number, size?: "sm" | "md" | "lg", decorative?: boolean, pop?: boolean, numbered?: boolean, className?: string }} props
 */
export function LevelBadge({
  level,
  size = "md",
  decorative = false,
  pop = false,
  numbered = true,
  className = "",
}) {
  const rank = rankForLevel(level);
  const classes = [styles.badge, styles[size], rank.glow && styles.glow, pop && styles.pop, className].filter(
    Boolean,
  );
  return (
    <Svg
      viewBox="0 0 48 52"
      title={decorative ? "" : `${rank.name} rank, level ${level}`}
      className={classes.join(" ")}
    >
      {rank.ring && (
        <path
          d={OUTER}
          transform="translate(24 26) scale(1.1) translate(-24 -26)"
          className={`${art.fNone} ${art.sPlatinum}`}
          strokeWidth="2.5"
        />
      )}
      <path d={OUTER} className={art[rank.tier]} />
      <path d={INNER} className={`${art.fNone} ${art.sOnTier} ${art.faint}`} strokeWidth="2" />
      {numbered && (
        <text
          x="24"
          y="27"
          textAnchor="middle"
          dominantBaseline="central"
          className={`${art.text} ${art.fOnTier} ${styles.number} ${level >= 100 ? styles.small : ""}`}
        >
          {level}
        </text>
      )}
    </Svg>
  );
}
