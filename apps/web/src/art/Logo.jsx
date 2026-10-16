import { Svg } from "./Svg.jsx";
import art from "./art.module.css";
import styles from "./Logo.module.css";

// The wordmark, drawn as round-capped strokes (no font needed): C l a s s i C a d e, with a joystick for the dot
// of the i. Baseline y = 39, x-height y = 21, ascenders y = 10.
const CLASSI = [
  "M25.9 15.1 A14 14 0 1 0 25.9 34.9", // C
  "M33 10 V39", // l
  "M57 30 A9 9 0 1 1 39 30 A9 9 0 1 1 57 30 M57 21 V39", // a
  "M72.5 22.6 A4.5 4.5 0 1 0 69 30 A4.5 4.5 0 1 1 65.5 37.4", // s
  "M86.5 22.6 A4.5 4.5 0 1 0 83 30 A4.5 4.5 0 1 1 79.5 37.4", // s
  "M94 25 V39", // i
];
const CADE = [
  "M127.9 15.1 A14 14 0 1 0 127.9 34.9", // C
  "M151 30 A9 9 0 1 1 133 30 A9 9 0 1 1 151 30 M151 21 V39", // a
  "M175 30 A9 9 0 1 1 157 30 A9 9 0 1 1 175 30 M175 10 V39", // d
  "M181 30 H199 A9 9 0 1 0 196.4 36.4", // e
];

/** The joystick that dots the i; also the app's glyph (favicon, LogoMark). */
function Joystick() {
  return (
    <g>
      <path d="M94 19 L98 12" className={`${art.sCurrent}`} strokeWidth="3" strokeLinecap="round" />
      <circle cx="99.5" cy="9.5" r="4.5" className={art.fAccent} />
    </g>
  );
}

/**
 * The ClassiCade wordmark. Decorative unless given a `title` (the header link already names it).
 *
 * @param {{ title?: string, className?: string }} props
 */
export function Logo({ title = "", className = "" }) {
  return (
    <Svg viewBox="0 0 206 46" title={title} className={`${styles.logo} ${className}`}>
      <g
        className={`${art.fNone} ${styles.word}`}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {CLASSI.map((d) => (
          <path key={d} d={d} className={art.sCurrent} />
        ))}
        {CADE.map((d) => (
          <path key={d} d={d} className={art.sPrimary} />
        ))}
      </g>
      <Joystick />
    </Svg>
  );
}

/**
 * The square brand glyph: a joystick on an arcade button pad.
 *
 * @param {{ title?: string, className?: string }} props
 */
export function LogoMark({ title = "", className = "" }) {
  return (
    <Svg viewBox="0 0 32 32" title={title} className={className}>
      <rect x="1" y="1" width="30" height="30" rx="9" className={art.fPrimary} />
      <ellipse cx="16" cy="24" rx="9" ry="3.5" className={art.fInk} opacity="0.35" />
      <path d="M16 23 L13 11" className={art.sWhite} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="12.5" cy="9.5" r="5" className={art.fAccent} />
      <circle cx="11" cy="8" r="1.6" className={art.fWhite} opacity="0.7" />
    </Svg>
  );
}
