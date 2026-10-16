import { KnightGlyph } from "../games/glyphs.jsx";
import { RockGlyph } from "../rps/hands.jsx";
import { Svg } from "../Svg.jsx";
import art from "../art.module.css";
import styles from "./AchievementIcon.module.css";

// Glyphs drawn on a 48 × 48 medal, in the "on tier" colour. Icon names match the achievement catalog (ADR-013).
const ink = art.fOnTier;
const line = { className: `${art.fNone} ${art.sOnTier}`, strokeLinecap: "round", strokeLinejoin: "round" };
const STAR =
  "M24 12 L26.9 20 L35.4 20.3 L28.8 25.6 L31.1 33.7 L24 29 L16.9 33.7 L19.2 25.6 L12.6 20.3 L21.1 20 Z";
const FLAME =
  "M24 10 C28 16 34 20 34 28 C34 34 29 38 24 38 C19 38 14 34 14 28 C14 22 19 20 20 14 C22 18 24 19 24 22 C26 18 25 14 24 10 Z";
const CALENDAR = (
  <>
    <rect x="13" y="15" width="22" height="20" rx="3" className={ink} />
    <rect x="13" y="15" width="22" height="6" rx="2" className={`${art.fInk} ${art.faint}`} />
    <path d="M18 12 V17 M30 12 V17" {...line} strokeWidth="2.5" />
  </>
);

/** @type {Readonly<Record<string, import("react").ReactNode>>} */
const GLYPHS = Object.freeze({
  flag: (
    <>
      <path d="M17 12 V37" {...line} strokeWidth="3" />
      <path d="M18 13 H34 L30 19 L34 25 H18 Z" className={ink} />
    </>
  ),
  trophy: (
    <>
      <path d="M16 12 H32 V18 Q32 28 24 29 Q16 28 16 18 Z" className={ink} />
      <path d="M16 15 H12 Q12 22 17 23 M32 15 H36 Q36 22 31 23" {...line} strokeWidth="2.5" />
      <rect x="22" y="28" width="4" height="6" className={ink} />
      <rect x="17" y="33" width="14" height="4" rx="1.5" className={ink} />
    </>
  ),
  star: <path d={STAR} className={ink} />,
  crown: (
    <>
      <path d="M12 32 L14 16 L20 23 L24 13 L28 23 L34 16 L36 32 Z" className={ink} />
      <rect x="12" y="32" width="24" height="4" rx="1.5" className={ink} />
    </>
  ),
  centurion: (
    <text
      x="24"
      y="25"
      textAnchor="middle"
      dominantBaseline="central"
      className={`${art.text} ${ink} ${styles.hundred}`}
    >
      100
    </text>
  ),
  flame: <path d={FLAME} className={ink} />,
  "flame-double": (
    <>
      <path d={FLAME} transform="translate(-6 4) scale(0.8)" className={ink} />
      <path d={FLAME} transform="translate(14 4) scale(0.8)" className={ink} />
    </>
  ),
  calendar: (
    <>
      {CALENDAR}
      <path
        d="M18 26 H22 M26 26 H30 M18 31 H22"
        {...line}
        className={`${art.fNone} ${art.sInk} ${art.half}`}
        strokeWidth="2.5"
      />
    </>
  ),
  "calendar-star": (
    <>
      {CALENDAR}
      <path d={STAR} transform="translate(14.4 16.5) scale(0.4)" className={`${art.fInk} ${art.half}`} />
    </>
  ),
  triad: (
    <>
      <path d="M24 15 L15 31 H33 Z" {...line} strokeWidth="2.5" />
      <circle cx="24" cy="15" r="5" className={ink} />
      <circle cx="15" cy="31" r="5" className={ink} />
      <circle cx="33" cy="31" r="5" className={ink} />
    </>
  ),
  fist: (
    <g transform="translate(10 10) scale(0.44)" className={styles.onTier}>
      <RockGlyph />
    </g>
  ),
  grid: <path d="M20 13 V35 M28 13 V35 M13 20 H35 M13 28 H35" {...line} strokeWidth="3" />,
  knight: (
    <g transform="translate(10 9) scale(0.44)" className={styles.onTier}>
      <KnightGlyph />
    </g>
  ),
  shield: <path d="M24 11 L35 15 V24 Q35 33 24 38 Q13 33 13 24 V15 Z" className={ink} />,
  scroll: (
    <>
      <rect x="15" y="13" width="18" height="23" rx="2" className={ink} />
      <rect x="13" y="11" width="22" height="5" rx="2.5" className={ink} />
      <rect x="13" y="33" width="22" height="5" rx="2.5" className={ink} />
      <path
        d="M19 21 H29 M19 25 H29 M19 29 H25"
        {...line}
        className={`${art.fNone} ${art.sInk} ${art.half}`}
        strokeWidth="2"
      />
    </>
  ),
});

/**
 * An achievement medal: the glyph on a tier-coloured disc. Locked achievements are a grey silhouette with a
 * padlock (the text next to it says "locked"). Decorative unless given a `title`. Unknown names are drawn as a
 * star, so a catalog entry newer than this build still renders.
 *
 * @param {{ name: string, tier?: "bronze" | "silver" | "gold" | "platinum", locked?: boolean, title?: string, className?: string }} props
 */
export function AchievementIcon({ name, tier = "bronze", locked = false, title = "", className = "" }) {
  const glyph = GLYPHS[name] ?? GLYPHS.star;
  return (
    <Svg
      viewBox="0 0 48 48"
      title={title}
      className={`${styles.icon} ${locked ? styles.isLocked : styles.unlocked} ${className}`}
    >
      <circle cx="24" cy="24" r="23" className={locked ? art.locked : art[tier]} />
      <circle
        cx="24"
        cy="24"
        r="19.5"
        className={`${art.fNone} ${art.sOnTier} ${art.faint}`}
        strokeWidth="1.5"
      />
      <g className={locked ? art.half : undefined}>{glyph}</g>
      {locked && (
        <g>
          <path
            d="M34 34 V31 A4 4 0 0 1 42 31 V34"
            className={`${art.fNone} ${art.sOnTier}`}
            strokeWidth="2.5"
          />
          <rect x="31.5" y="33" width="13" height="10" rx="2" className={art.fOnTier} />
          <circle cx="38" cy="38" r="1.6" className={art.locked} />
        </g>
      )}
    </Svg>
  );
}
