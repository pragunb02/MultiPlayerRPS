import { Svg } from "../Svg.jsx";
import art from "../art.module.css";

/**
 * An X that draws itself in, stroke by stroke (pathLength = 1 so the dash maths is size-independent).
 *
 * @param {{ title?: string, className?: string }} props
 */
export function MarkX({ title = "", className = "" }) {
  return (
    <Svg viewBox="0 0 64 64" title={title} className={className}>
      <path
        d="M14 14 L50 50"
        pathLength="1"
        className={`${art.fNone} ${art.sCurrent} ${art.draw}`}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d="M50 14 L14 50"
        pathLength="1"
        className={`${art.fNone} ${art.sCurrent} ${art.draw} ${art.delay1}`}
        strokeWidth="9"
        strokeLinecap="round"
      />
    </Svg>
  );
}
