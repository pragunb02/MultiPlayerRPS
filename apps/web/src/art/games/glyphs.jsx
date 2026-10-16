import art from "../art.module.css";

// Simple game glyphs on a 64 × 64 grid, as <g> groups that icons, cards and medals place and colour.

/** A chess knight, facing left. */
export function KnightGlyph() {
  return (
    <g>
      <path
        d="M18 58 H50 V52 Q50 49 46 48 L44 40 Q53 33 52 21 Q50 9 38 6 L35 1 L32 7 Q24 8 18 15 L10 26 Q8 31 12 33 L15 35 Q19 36 22 33 L28 30 Q30 35 25 41 Q21 45 21 48 Q18 49 18 52 Z"
        className={art.fCurrent}
      />
      <circle cx="30" cy="16" r="2.4" className={`${art.fInk} ${art.half}`} />
      <path
        d="M40 12 Q47 18 46 30"
        className={`${art.fNone} ${art.sInk} ${art.faint}`}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </g>
  );
}

/** A chess pawn. */
export function PawnGlyph() {
  return (
    <g>
      <circle cx="32" cy="15" r="9" className={art.fCurrent} />
      <path
        d="M22 27 H42 Q42 31 38 32 Q36 40 43 48 H21 Q28 40 26 32 Q22 31 22 27 Z"
        className={art.fCurrent}
      />
      <rect x="16" y="48" width="32" height="9" rx="4.5" className={art.fCurrent} />
    </g>
  );
}

/** A noughts-and-crosses grid with one X and one O. */
export function GridGlyph() {
  return (
    <g strokeLinecap="round" className={art.fNone}>
      <path d="M25 8 V56 M39 8 V56 M8 25 H56 M8 39 H56" className={art.sCurrent} strokeWidth="5" />
      <path d="M11 11 L21 21 M21 11 L11 21" className={art.sCurrent} strokeWidth="4" />
      <circle cx="47.5" cy="47.5" r="5.5" className={art.sCurrent} strokeWidth="4" />
    </g>
  );
}

/** A joystick: the generic "game" glyph for games this build has no art for yet. */
export function JoystickGlyph() {
  return (
    <g>
      <rect x="8" y="42" width="48" height="14" rx="7" className={art.fCurrent} />
      <path
        d="M32 44 L27 20"
        className={`${art.fNone} ${art.sCurrent}`}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="26" cy="16" r="10" className={art.fCurrent} />
      <circle cx="47" cy="49" r="3.5" className={`${art.fInk} ${art.faint}`} />
    </g>
  );
}
