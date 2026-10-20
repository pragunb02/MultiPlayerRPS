import styles from "./avatars.module.css";

// The twelve avatars of the catalogue (CC-034), drawn by hand in code for ClassiCade on a 64 by 64 grid. Each is a
// few flat shapes in the neon inks on the dark arcade tile that `Avatar` draws behind it. No reference art was traced
// or copied. A new avatar is one more drawing here and one more entry in `avatarArt.js`, with the same id as in
// `AVATARS` (packages/shared/src/avatars.js).

const n = styles;

/** The Bolt avatar, drawn for ClassiCade. */
export function Bolt() {
  return <path className={n.gold} d="M36 8 L18 36 H30 L26 56 L46 26 H34 Z" />;
}

/** The Rocket avatar, drawn for ClassiCade. */
export function Rocket() {
  return (
    <g>
      <path className={n.rps} d="M26 46 L32 58 L38 46 Z" />
      <path className={n.accent} d="M22 34 L14 46 H24 Z M42 34 L50 46 H40 Z" />
      <path className={n.white} d="M32 6 C42 14 44 28 40 46 H24 C20 28 22 14 32 6 Z" />
      <circle className={n.xp} cx="32" cy="26" r="6" />
      <circle className={n.ink} cx="32" cy="26" r="3" />
    </g>
  );
}

/** The Robot avatar, drawn for ClassiCade. */
export function Robot() {
  return (
    <g>
      <rect className={n.gold} x="30" y="6" width="4" height="10" />
      <circle className={n.accent} cx="32" cy="7" r="4" />
      <rect className={n.xp} x="14" y="16" width="36" height="32" rx="6" />
      <rect className={n.ink} x="20" y="24" width="8" height="8" />
      <rect className={n.ink} x="36" y="24" width="8" height="8" />
      <rect className={n.ink} x="22" y="38" width="20" height="4" />
      <rect className={n.xp} x="20" y="50" width="24" height="8" rx="2" />
    </g>
  );
}

/** The Cat avatar, drawn for ClassiCade. */
export function Cat() {
  return (
    <g>
      <path
        className={n.accent}
        d="M12 26 L16 8 L28 18 H36 L48 8 L52 26 C54 44 44 56 32 56 C20 56 10 44 12 26 Z"
      />
      <path className={n.ink} d="M22 32 Q25 27 28 32 Q25 35 22 32 Z M36 32 Q39 27 42 32 Q39 35 36 32 Z" />
      <path className={n.gold} d="M29 40 H35 L32 44 Z" />
      <path className={n.whiteLine} d="M8 40 H22 M8 46 L22 43 M56 40 H42 M56 46 L42 43" />
    </g>
  );
}

/** The Fox avatar, drawn for ClassiCade. */
export function Fox() {
  return (
    <g>
      <path className={n.rps} d="M10 10 L24 22 H40 L54 10 L52 34 L32 56 L12 34 Z" />
      <path className={n.white} d="M12 34 L26 32 L32 46 L38 32 L52 34 L32 56 Z" />
      <circle className={n.ink} cx="24" cy="30" r="3" />
      <circle className={n.ink} cx="40" cy="30" r="3" />
      <circle className={n.ink} cx="32" cy="52" r="3" />
    </g>
  );
}

/** The Owl avatar, drawn for ClassiCade. */
export function Owl() {
  return (
    <g>
      <path
        className={n.tictactoe}
        d="M14 14 L22 20 H42 L50 14 V44 C50 52 42 58 32 58 C22 58 14 52 14 44 Z"
      />
      <circle className={n.white} cx="24" cy="30" r="8" />
      <circle className={n.white} cx="40" cy="30" r="8" />
      <circle className={n.ink} cx="24" cy="30" r="4" />
      <circle className={n.ink} cx="40" cy="30" r="4" />
      <path className={n.gold} d="M29 38 H35 L32 45 Z" />
      <path className={n.inkLine} d="M24 50 L28 47 L32 50 L36 47 L40 50" />
    </g>
  );
}

/** The Crown avatar, drawn for ClassiCade. */
export function Crown() {
  return (
    <g>
      <path className={n.gold} d="M10 46 L8 18 L22 30 L32 12 L42 30 L56 18 L54 46 Z" />
      <rect className={n.gold} x="10" y="48" width="44" height="8" rx="2" />
      <circle className={n.accent} cx="32" cy="38" r="5" />
      <circle className={n.xp} cx="18" cy="40" r="3" />
      <circle className={n.xp} cx="46" cy="40" r="3" />
    </g>
  );
}

/** The Planet avatar, drawn for ClassiCade. */
export function Planet() {
  return (
    <g>
      <circle className={n.accent} cx="32" cy="32" r="16" />
      <path className={n.inkLine} d="M20 26 Q32 22 44 28 M22 38 Q32 34 42 40" />
      <ellipse className={n.xpRing} cx="32" cy="34" rx="28" ry="8" transform="rotate(-18 32 34)" />
      <circle className={n.gold} cx="12" cy="12" r="2" />
      <circle className={n.white} cx="52" cy="54" r="2" />
    </g>
  );
}

/** The Dice avatar, drawn for ClassiCade. */
export function Dice() {
  return (
    <g>
      <rect className={n.white} x="12" y="12" width="40" height="40" rx="8" transform="rotate(8 32 32)" />
      <g transform="rotate(8 32 32)">
        <circle className={n.ink} cx="22" cy="22" r="4" />
        <circle className={n.ink} cx="42" cy="22" r="4" />
        <circle className={n.accent} cx="32" cy="32" r="4" />
        <circle className={n.ink} cx="22" cy="42" r="4" />
        <circle className={n.ink} cx="42" cy="42" r="4" />
      </g>
    </g>
  );
}

/** The Knight avatar, drawn for ClassiCade. */
export function Knight() {
  return (
    <g>
      <path
        className={n.chess}
        d="M20 50 C20 40 26 36 28 30 L18 32 L16 26 L28 12 L32 6 L34 12 C46 16 50 30 46 50 Z"
      />
      <circle className={n.ink} cx="30" cy="20" r="2.5" />
      <rect className={n.chess} x="14" y="50" width="38" height="8" rx="2" />
      <path className={n.goldLine} d="M38 18 C44 26 44 38 40 48" />
    </g>
  );
}

/** The Cactus avatar, drawn for ClassiCade. */
export function Cactus() {
  return (
    <g>
      <path className={n.tictactoe} d="M26 50 V14 C26 8 38 8 38 14 V50 Z" />
      <path className={n.tictactoe} d="M26 34 H18 C14 34 12 31 12 28 V20 C12 16 18 16 18 20 V28 H26 Z" />
      <path className={n.tictactoe} d="M38 28 H46 V18 C46 14 52 14 52 18 V26 C52 30 50 32 46 32 H38 Z" />
      <path className={n.accent} d="M28 10 Q32 4 36 10 Q32 13 28 10 Z" />
      <path className={n.rps} d="M18 48 H46 L42 60 H22 Z" />
      <path className={n.inkLine} d="M30 20 V24 M34 30 V34 M30 40 V44" />
    </g>
  );
}

/** The Comet avatar, drawn for ClassiCade. */
export function Comet() {
  return (
    <g>
      <path className={n.xpLine} d="M10 10 L34 30 M8 24 L30 36 M22 6 L38 26" />
      <circle className={n.gold} cx="40" cy="38" r="14" />
      <circle className={n.white} cx="36" cy="34" r="4" />
      <circle className={n.rps} cx="46" cy="44" r="3" />
    </g>
  );
}
