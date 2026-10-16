import { KnightGlyph } from "./games/glyphs.jsx";
import { Placed } from "./Placed.jsx";
import { RockGlyph } from "./rps/hands.jsx";
import { Sparkle } from "./Sparkle.jsx";
import { Svg } from "./Svg.jsx";
import art from "./art.module.css";
import styles from "./HeroArt.module.css";

// Perspective floor: lines from the vanishing point (200, 200) to the bottom edge, cut at the horizon (y = 236).
const HORIZON = 236;
const FLOOR_RAYS = [-200, -60, 60, 140, 200, 260, 340, 460, 600].map((bottomX) => {
  const t = (HORIZON - 200) / (320 - 200);
  return `M${200 + (bottomX - 200) * t} ${HORIZON} L${bottomX} 320`;
});
const FLOOR_LINES = [244, 256, 274, 300].map((y) => `M0 ${y} H400`);

/**
 * The home page's arcade scene: a cabinet on a neon grid floor with a fist, an X and O and a knight floating
 * around it. Decorative — the hero text says what ClassiCade is.
 *
 * @param {{ className?: string }} props
 */
export function HeroArt({ className = "" }) {
  return (
    <Svg viewBox="0 0 400 320" className={`${styles.hero} ${className}`}>
      <g className={`${art.fNone} ${styles.floor}`} strokeWidth="2">
        {[...FLOOR_RAYS, ...FLOOR_LINES].map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <ellipse cx="200" cy="304" rx="96" ry="12" className={`${art.fInk} ${art.faint}`} />

      {/* The cabinet */}
      <path
        d="M150 40 H250 Q258 40 258 48 V70 L268 168 L276 196 V300 H124 V196 L132 168 L142 70 V48 Q142 40 150 40 Z"
        className={styles.cabinet}
      />
      <path d="M142 70 L132 168 H268 L258 70 Z" className={`${art.fPrimary} ${art.faint}`} />
      <rect x="150" y="46" width="100" height="20" rx="5" className={art.fAccent} />
      <g className={art.fWhite}>
        <circle cx="168" cy="56" r="2.5" />
        <circle cx="200" cy="56" r="2.5" />
        <circle cx="232" cy="56" r="2.5" />
      </g>
      <rect x="156" y="80" width="88" height="74" rx="8" className={styles.screen} />
      <g className={art.fNone} strokeWidth="5" strokeLinecap="round">
        <path d="M172 100 L190 118 M190 100 L172 118" className={art.sTicTacToe} />
        <circle cx="222" cy="109" r="10" className={art.sRps} />
        <path d="M168 138 H232" className={`${art.sXp} ${art.faint}`} />
      </g>
      <path d="M128 172 H272 L282 200 H118 Z" className={styles.panel} />
      <path
        d="M184 188 L178 170"
        className={`${art.fNone} ${art.sInk}`}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="177" cy="166" r="7" className={art.fAccent} />
      <circle cx="214" cy="186" r="5.5" className={art.fXp} />
      <circle cx="232" cy="182" r="5.5" className={art.fGold} />
      <circle cx="250" cy="186" r="5.5" className={art.fTicTacToe} />
      <rect x="186" y="228" width="28" height="30" rx="4" className={`${art.fPrimary} ${art.half}`} />
      <rect x="198" y="234" width="4" height="16" rx="2" className={art.fGold} />

      {/* Floating game pieces */}
      <Placed x={34} y={70} scale={1.2} className={`${styles.rps} ${art.floatIn}`}>
        <RockGlyph />
      </Placed>
      <Placed x={300} y={36} className={`${art.floatIn} ${art.delay1}`}>
        <g className={art.fNone} strokeLinecap="round" strokeWidth="9">
          <path d="M8 8 L40 40 M40 8 L8 40" className={art.sTicTacToe} />
        </g>
      </Placed>
      <Placed x={316} y={112} className={`${art.floatIn} ${art.delay2}`}>
        <circle cx="22" cy="22" r="17" className={`${art.fNone} ${art.sAccent}`} strokeWidth="8" />
      </Placed>
      <Placed x={292} y={190} scale={1.1} className={`${styles.chess} ${art.floatIn} ${art.delay3}`}>
        <KnightGlyph />
      </Placed>

      <Sparkle x={70} y={30} />
      <Sparkle x={112} y={150} size={0.7} className={art.fAccent} />
      <Sparkle x={300} y={22} size={0.6} className={art.fXp} />
      <Sparkle x={372} y={170} size={0.9} />
      <Sparkle x={36} y={196} size={0.8} className={art.fXp} />
    </Svg>
  );
}
