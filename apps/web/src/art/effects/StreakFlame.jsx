import { Svg } from "../Svg.jsx";
import art from "../art.module.css";
import styles from "./effects.module.css";

/**
 * A streak counter: a flame and the number of days. A streak of 0 shows an unlit (grey) flame. Screen readers
 * hear "<n>-day streak" (or the `label` given).
 *
 * @param {{ count: number, label?: string, className?: string }} props
 */
export function StreakFlame({ count, label = `${count}-day streak`, className = "" }) {
  return (
    <span className={`${styles.streak} ${count === 0 ? styles.inactive : ""} ${className}`}>
      <Svg viewBox="0 0 48 48" className={styles.flame}>
        <path
          d="M24 4 C30 12 38 18 38 29 C38 38 31 44 24 44 C17 44 10 38 10 29 C10 21 17 18 18 10 C21 15 23 17 23 21 C26 16 26 10 24 4 Z"
          className={art.fCurrent}
        />
        <path
          d="M24 26 C28 30 31 33 31 36 C31 40 28 43 24 43 C20 43 17 40 17 36 C17 32 21 30 24 26 Z"
          className={count === 0 ? art.fRaised : art.fGold}
        />
      </Svg>
      <span aria-hidden="true">{count}</span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
