import { PawnGlyph } from "../games/glyphs.jsx";
import { Placed } from "../Placed.jsx";
import { Sparkle } from "../Sparkle.jsx";
import { Svg } from "../Svg.jsx";
import art from "../art.module.css";
import styles from "./illustrations.module.css";

/**
 * An open envelope with a game piece popping out: "you're invited". Decorative unless given a `title`.
 *
 * @param {{ title?: string, className?: string }} props
 */
export function InviteArt({ title = "", className = "" }) {
  return (
    <Svg
      viewBox="0 0 160 120"
      title={title}
      className={`${styles.illustration} ${styles.small} ${className}`}
    >
      <ellipse cx="80" cy="112" rx="56" ry="6" className={`${art.fPrimary} ${art.faint}`} />
      <path d="M28 52 L80 18 L132 52 Z" className={art.fPrimary} />
      <Placed x={56} y={6} scale={0.75} className={`${styles.gold} ${art.floatIn}`}>
        <PawnGlyph />
      </Placed>
      <rect x="40" y="38" width="80" height="34" rx="4" className={art.fSurface} />
      <path d="M28 52 V104 Q28 108 32 108 H128 Q132 108 132 104 V52 L80 84 Z" className={art.fPrimary} />
      <path
        d="M28 104 L66 74 M132 104 L94 74"
        className={`${art.fNone} ${art.sInk} ${art.faint}`}
        strokeWidth="3"
      />
      <circle cx="80" cy="86" r="8" className={art.fAccent} />
      <Sparkle x={140} y={22} />
      <Sparkle x={20} y={36} size={0.7} className={art.fAccent} />
    </Svg>
  );
}
