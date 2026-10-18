import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { Svg } from "../Svg.jsx";
import styles from "./Bit.module.css";
import { BIT_POSE_NAMES, BIT_POSES } from "./bitPoses.js";

// A placeholder drawing of Bit, drawn by hand in code from the brief in docs/story/STORY_MODE.md section 3 (CC-230).
// An artist's version replaces the shapes in this file later, and callers keep using <Bit pose="..." /> unchanged.
// Bit is a small arcade cabinet on two wheels: the screen is its face, a joystick on its head is the antenna, and
// its arms end in two round arcade buttons. Every pose shares the body and swaps only the face, arms and antenna.

/** Eyes and mouth drawn as pixels on the screen. */
const FACES = Object.freeze({
  idle: () => (
    <g className={styles.pixels}>
      <rect x="62" y="72" width="8" height="8" />
      <rect x="90" y="72" width="8" height="8" />
      <rect x="68" y="88" width="4" height="4" />
      <rect x="72" y="92" width="16" height="4" />
      <rect x="88" y="88" width="4" height="4" />
    </g>
  ),
  happy: () => <JoyFace />,
  sad: () => (
    <g>
      <path d="M58 81 L62 77 H72 M88 77 H98 L102 81" className={styles.lines} />
      <path d="M72 95 Q80 89 88 95" className={styles.lines} />
    </g>
  ),
  thinking: () => (
    <g>
      <g className={styles.pixels}>
        <rect x="63" y="70" width="7" height="7" />
        <rect x="90" y="72" width="9" height="4" />
      </g>
      <g className={`${styles.pixels} ${styles.dots}`}>
        <rect x="64" y="88" width="6" height="6" />
        <rect x="77" y="88" width="6" height="6" />
        <rect x="90" y="88" width="6" height="6" />
      </g>
    </g>
  ),
  surprised: () => (
    <g className={styles.lines}>
      <rect x="60" y="70" width="12" height="12" />
      <rect x="88" y="70" width="12" height="12" />
      <rect x="76" y="89" width="8" height="8" strokeWidth="3" />
    </g>
  ),
  cheer: () => <JoyFace />,
});

/** Eyes closed in two upward arcs and a wide open smile, for happy and cheer. */
function JoyFace() {
  return (
    <g>
      <path d="M60 81 L66 75 L72 81 M88 81 L94 75 L100 81" className={styles.lines} />
      <path d="M68 88 H92 Q92 98 80 98 Q68 98 68 88 Z" className={styles.pixels} />
    </g>
  );
}

const ARMS_DOWN = Object.freeze({
  left: { d: "M44 96 Q30 104 28 115", x: 28, y: 118 },
  right: { d: "M116 96 Q130 104 132 115", x: 132, y: 118 },
});

/**
 * How each pose holds the arms and the antenna. Each arm is a curve from the shoulder and the spot of its button.
 * `tilt` turns the joystick antenna in degrees, `lean` turns the whole robot back on its wheels.
 */
const POSES = Object.freeze({
  idle: { ...ARMS_DOWN, tilt: 0, lean: 0, glow: false, dim: false, sparks: false },
  happy: {
    left: ARMS_DOWN.left,
    right: { d: "M116 90 Q134 82 137 64", x: 138, y: 60 },
    tilt: 0,
    lean: 0,
    glow: true,
    dim: false,
    sparks: false,
  },
  sad: {
    left: { d: "M44 100 Q38 112 38 124", x: 38, y: 127 },
    right: { d: "M116 100 Q122 112 122 124", x: 122, y: 127 },
    tilt: -14,
    lean: 0,
    glow: false,
    dim: true,
    sparks: false,
  },
  thinking: {
    left: ARMS_DOWN.left,
    right: { d: "M116 110 Q142 112 132 97", x: 128, y: 94 },
    tilt: 16,
    lean: 0,
    glow: false,
    dim: false,
    sparks: false,
  },
  surprised: {
    left: { d: "M44 90 Q30 86 23 79", x: 20, y: 76 },
    right: { d: "M116 90 Q130 86 137 79", x: 140, y: 76 },
    tilt: 0,
    lean: -6,
    glow: false,
    dim: false,
    sparks: true,
  },
  cheer: {
    left: { d: "M44 88 Q28 76 24 57", x: 24, y: 52 },
    right: { d: "M116 88 Q132 76 136 57", x: 136, y: 52 },
    tilt: 0,
    lean: 0,
    glow: true,
    dim: false,
    sparks: true,
  },
});

/**
 * Bit, the arcade's caretaker robot and ClassiCade's mascot, in one of six poses. This is a placeholder drawing
 * until an artist's version replaces it (see docs/art/README.md).
 *
 * Bit is a named image by default, named after the pose. Pass `decorative` when text beside it already says the
 * same, and screen readers skip it. Bit hops once and its antenna glows when it appears, unless the player asked
 * for reduced motion, and then it stays still.
 *
 * @param {{ pose?: string, size?: number, title?: string, decorative?: boolean, className?: string }} props
 *   `pose` is one of `BIT_POSES` (idle by default). `size` is the width and height in pixels (64 by default).
 *   `title` replaces the pose's accessible name.
 */
export function Bit({
  pose = "idle",
  size = 64,
  title = BIT_POSE_NAMES[pose],
  decorative = false,
  className = "",
}) {
  const reducedMotion = useReducedMotion();
  if (!BIT_POSES.includes(pose)) {
    throw new RangeError(`Bit has no pose "${pose}". Use one of: ${BIT_POSES.join(", ")}`);
  }
  const { left, right, tilt, lean, glow, dim, sparks } = POSES[pose];
  const Face = FACES[pose];
  const motion = reducedMotion ? "" : styles.alive;
  return (
    <Svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      title={decorative ? "" : title}
      className={`${styles.bit} ${className}`}
    >
      <g transform={`rotate(${lean} 80 150)`} data-pose={pose}>
        <g className={`${styles.figure} ${motion}`}>
          <g transform={`rotate(${tilt} 80 52)`}>
            {glow && <circle cx="80" cy="22" r="15" className={styles.glow} />}
            <path d="M80 50 V28" className={styles.limbEdge} />
            <path d="M80 50 V28" className={styles.limb} />
            <rect x="71" y="46" width="18" height="8" rx="3" className={styles.wheel} />
            <circle cx="80" cy="22" r="8" className={styles.ball} opacity={dim ? 0.45 : 1} />
          </g>
          {sparks && <path d="M67 13 L61 7 M93 13 L99 7 M80 9 V2" className={styles.sparks} />}
          <path d={`${left.d} ${right.d}`} className={styles.limbEdge} />
          <path d={`${left.d} ${right.d}`} className={styles.limb} />
          <circle cx="60" cy="140" r="11" className={styles.wheel} />
          <circle cx="100" cy="140" r="11" className={styles.wheel} />
          <circle cx="60" cy="140" r="3" className={styles.hub} />
          <circle cx="100" cy="140" r="3" className={styles.hub} />
          <rect x="40" y="52" width="80" height="84" rx="16" className={styles.cabinet} />
          <rect x="47" y="57" width="14" height="5" rx="2.5" className={styles.highlight} />
          <rect x="50" y="62" width="60" height="42" rx="7" className={styles.screen} />
          <rect x="72" y="114" width="16" height="11" rx="3" className={styles.ink} />
          <rect x="78" y="116" width="4" height="7" rx="1" className={styles.slot} />
          <Face />
          <circle cx={left.x} cy={left.y} r="7" className={styles.buttonGold} />
          <circle cx={right.x} cy={right.y} r="7" className={styles.buttonTeal} />
        </g>
      </g>
    </Svg>
  );
}
