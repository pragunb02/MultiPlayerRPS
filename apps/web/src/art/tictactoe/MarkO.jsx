import { Svg } from "../Svg.jsx";
import art from "../art.module.css";

/**
 * An O that draws itself in as one round stroke.
 *
 * @param {{ title?: string, className?: string }} props
 */
export function MarkO({ title = "", className = "" }) {
  return (
    <Svg viewBox="0 0 64 64" title={title} className={className}>
      <circle
        cx="32"
        cy="32"
        r="19"
        pathLength="1"
        transform="rotate(-90 32 32)"
        className={`${art.fNone} ${art.sCurrent} ${art.draw}`}
        strokeWidth="9"
        strokeLinecap="round"
      />
    </Svg>
  );
}
