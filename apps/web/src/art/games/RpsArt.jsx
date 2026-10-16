import { Placed } from "../Placed.jsx";
import { Sparkle } from "../Sparkle.jsx";
import { Svg } from "../Svg.jsx";
import art from "../art.module.css";
import { PaperGlyph, RockGlyph, ScissorsGlyph } from "../rps/hands.jsx";
import styles from "./gameArt.module.css";

/**
 * Rock, paper and scissors facing off in a triangle, with motion lines.
 *
 * @param {{ title?: string, className?: string }} props
 */
export function RpsArt({ title = "", className = "" }) {
  return (
    <Svg viewBox="0 0 240 150" title={title} className={`${styles.art} ${className}`}>
      <circle cx="120" cy="80" r="58" className={`${art.fRps} ${art.faint}`} />
      <path
        d="M120 52 L127 70 L146 72 L131 84 L136 102 L120 92 L104 102 L109 84 L94 72 L113 70 Z"
        className={`${art.fGold} ${art.half}`}
      />
      <g className={`${art.fNone} ${art.sRps}`} strokeWidth="4" strokeLinecap="round">
        <path d="M70 22 H84 M66 32 H80" />
        <path d="M24 106 L34 96 M22 120 H36" />
        <path d="M206 96 L216 106 M204 120 H218" />
      </g>
      <Placed x={88} y={4} scale={1} className={`${styles.rps} ${art.floatIn}`}>
        <RockGlyph />
      </Placed>
      <Placed x={32} y={70} scale={1.05} className={`${styles.accent} ${art.floatIn} ${art.delay1}`}>
        <PaperGlyph />
      </Placed>
      <Placed x={142} y={70} scale={1.05} className={`${styles.gold} ${art.floatIn} ${art.delay2}`}>
        <ScissorsGlyph />
      </Placed>
      <Sparkle x={196} y={26} />
      <Sparkle x={40} y={40} size={0.7} className={art.fAccent} />
    </Svg>
  );
}
