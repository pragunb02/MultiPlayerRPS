import { Placed } from "../Placed.jsx";
import { Sparkle } from "../Sparkle.jsx";
import { Svg } from "../Svg.jsx";
import art from "../art.module.css";
import { KnightGlyph, PawnGlyph } from "./glyphs.jsx";
import styles from "./gameArt.module.css";

const SQUARES = Array.from({ length: 16 }, (_, i) => ({ row: Math.floor(i / 4), column: i % 4 }));

/**
 * A knight and a pawn on a tilted checkered tile.
 *
 * @param {{ title?: string, className?: string }} props
 */
export function ChessArt({ title = "", className = "" }) {
  return (
    <Svg viewBox="0 0 240 150" title={title} className={`${styles.art} ${className}`}>
      <ellipse cx="120" cy="122" rx="84" ry="20" className={`${art.fChess} ${art.faint}`} />
      <g transform="translate(120 104) scale(1 0.5) rotate(45)">
        {SQUARES.map(({ row, column }) => (
          <rect
            key={`${row}${column}`}
            x={-44 + column * 22}
            y={-44 + row * 22}
            width="22"
            height="22"
            className={(row + column) % 2 === 0 ? art.fBoardLight : art.fChess}
          />
        ))}
      </g>
      <Placed x={70} y={12} scale={1.35} className={`${styles.chess} ${art.floatIn}`}>
        <KnightGlyph />
      </Placed>
      <Placed x={136} y={50} scale={0.85} className={`${styles.gold} ${art.floatIn} ${art.delay2}`}>
        <PawnGlyph />
      </Placed>
      <Sparkle x={200} y={30} className={art.fChess} />
      <Sparkle x={44} y={36} size={0.75} />
    </Svg>
  );
}
