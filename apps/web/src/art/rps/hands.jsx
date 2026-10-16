import art from "../art.module.css";

// Hand shapes on a 64 × 64 grid, as <g> groups so bigger scenes (RpsArt, GameIcon) can place them. Filled with
// the current colour; details in a darker ink at low opacity, so one shape works in both themes.

/** A closed fist, knuckles forward, thumb across. */
export function RockGlyph() {
  return (
    <g>
      <rect x="22" y="52" width="22" height="10" rx="2" className={art.fCurrent} />
      <path
        d="M14 27 Q14 17 23 17 H43 Q52 17 52 27 V44 Q52 56 40 56 H26 Q14 56 14 44 Z"
        className={art.fCurrent}
      />
      <path
        d="M24.5 18 V30 M33 18 V30 M41.5 18 V30"
        className={`${art.sInk} ${art.faint}`}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M11 38 Q11 31 19 31 H34 Q41 31 41 36.5 Q41 42 34 42 H19 Q11 42 11 38 Z"
        className={art.fCurrent}
      />
      <path
        d="M11 38 Q11 31 19 31 H34 Q41 31 41 36.5 Q41 42 34 42 H19 Q11 42 11 38 Z"
        className={`${art.fNone} ${art.sInk} ${art.faint}`}
        strokeWidth="2"
      />
    </g>
  );
}

/** An open hand, fingers together, thumb out. */
export function PaperGlyph() {
  return (
    <g>
      <rect x="26" y="52" width="22" height="10" rx="2" className={art.fCurrent} />
      <rect x="19" y="8" width="8.5" height="30" rx="4.25" className={art.fCurrent} />
      <rect x="28.5" y="3" width="8.5" height="34" rx="4.25" className={art.fCurrent} />
      <rect x="38" y="5" width="8.5" height="33" rx="4.25" className={art.fCurrent} />
      <rect x="47.5" y="12" width="7.5" height="28" rx="3.75" className={art.fCurrent} />
      <rect x="19" y="27" width="36" height="29" rx="11" className={art.fCurrent} />
      <rect
        x="6"
        y="30"
        width="9"
        height="24"
        rx="4.5"
        transform="rotate(-38 10.5 42)"
        className={art.fCurrent}
      />
      <path
        d="M27.75 12 V30 M37.25 9 V30 M46.75 14 V31"
        className={`${art.sInk} ${art.faint}`}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </g>
  );
}

/** Two fingers in a V, the others curled under the thumb. */
export function ScissorsGlyph() {
  return (
    <g>
      <rect x="22" y="52" width="22" height="10" rx="2" className={art.fCurrent} />
      <rect
        x="18"
        y="3"
        width="9"
        height="34"
        rx="4.5"
        transform="rotate(-14 22.5 36)"
        className={art.fCurrent}
      />
      <rect
        x="31"
        y="3"
        width="9"
        height="34"
        rx="4.5"
        transform="rotate(14 35.5 36)"
        className={art.fCurrent}
      />
      <rect x="15" y="29" width="35" height="27" rx="11" className={art.fCurrent} />
      <path
        d="M40 31 Q48 31 48 37 M41 39 Q49 39 49 45"
        className={`${art.fNone} ${art.sInk} ${art.faint}`}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 41 Q12 35 19 35 H32 Q38 35 38 40 Q38 45 32 45 H19 Q12 45 12 41 Z"
        className={`${art.fCurrent}`}
      />
      <path
        d="M12 41 Q12 35 19 35 H32 Q38 35 38 40 Q38 45 32 45 H19 Q12 45 12 41 Z"
        className={`${art.fNone} ${art.sInk} ${art.faint}`}
        strokeWidth="2"
      />
    </g>
  );
}
