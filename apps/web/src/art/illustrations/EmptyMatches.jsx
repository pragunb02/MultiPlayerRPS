import { Svg } from "../Svg.jsx";
import art from "../art.module.css";
import styles from "./illustrations.module.css";

/**
 * A joystick asleep, for "no matches yet". Decorative unless given a `title`.
 *
 * @param {{ title?: string, className?: string }} props
 */
export function EmptyMatches({ title = "", className = "" }) {
  return (
    <Svg
      viewBox="0 0 160 110"
      title={title}
      className={`${styles.illustration} ${styles.small} ${className}`}
    >
      <ellipse cx="70" cy="98" rx="52" ry="7" className={`${art.fPrimary} ${art.faint}`} />
      <rect x="22" y="66" width="96" height="30" rx="15" className={art.fPrimary} />
      <path
        d="M70 68 L56 34"
        className={`${art.fNone} ${art.sMuted}`}
        strokeWidth="8"
        strokeLinecap="round"
      />
      <circle cx="53" cy="28" r="15" className={art.fAccent} />
      <g className={`${art.fNone} ${art.sWhite}`} strokeWidth="3" strokeLinecap="round">
        <path d="M54 80 Q60 85 66 80 M76 80 Q82 85 88 80" />
      </g>
      <circle cx="104" cy="81" r="5" className={`${art.fGold}`} />
      <g
        className={`${art.fNone} ${art.sPrimary}`}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M100 20 H112 L100 32 H112" />
        <path d="M120 6 H128 L120 14 H128" />
        <path d="M134 30 H140 L134 36 H140" />
      </g>
    </Svg>
  );
}
