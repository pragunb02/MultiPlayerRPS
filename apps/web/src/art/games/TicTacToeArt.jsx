import { Sparkle } from "../Sparkle.jsx";
import { Svg } from "../Svg.jsx";
import art from "../art.module.css";
import styles from "./gameArt.module.css";

const X_CELLS = [
  [90, 45],
  [120, 75],
  [150, 105],
];
const O_CELLS = [
  [150, 45],
  [90, 105],
];

/**
 * A neon noughts-and-crosses board with a winning diagonal struck through.
 *
 * @param {{ title?: string, className?: string }} props
 */
export function TicTacToeArt({ title = "", className = "" }) {
  const grid = "M105 30 V120 M135 30 V120 M75 60 H165 M75 90 H165";
  return (
    <Svg viewBox="0 0 240 150" title={title} className={`${styles.art} ${className}`}>
      <rect x="62" y="17" width="116" height="116" rx="18" className={`${art.fTicTacToe} ${art.faint}`} />
      <g className={art.fNone} strokeLinecap="round">
        <path d={grid} className={`${art.sTicTacToe} ${art.faint}`} strokeWidth="12" />
        <path d={grid} className={art.sTicTacToe} strokeWidth="5" />
        {X_CELLS.map(([x, y]) => (
          <path
            key={`x${x}`}
            d={`M${x - 9} ${y - 9} L${x + 9} ${y + 9} M${x + 9} ${y - 9} L${x - 9} ${y + 9}`}
            className={art.sAccent}
            strokeWidth="6"
          />
        ))}
        {O_CELLS.map(([x, y]) => (
          <circle key={`o${x}`} cx={x} cy={y} r="9" className={art.sXp} strokeWidth="6" />
        ))}
        <path
          d="M78 33 L162 117"
          pathLength="1"
          className={`${art.sGold} ${art.draw} ${art.delay3}`}
          strokeWidth="6"
        />
      </g>
      <Sparkle x={196} y={36} className={art.fTicTacToe} />
      <Sparkle x={42} y={112} size={0.8} />
    </Svg>
  );
}
