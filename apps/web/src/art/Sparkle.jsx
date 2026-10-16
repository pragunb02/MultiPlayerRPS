import art from "./art.module.css";

/**
 * A four-point star that twinkles a few times, then rests. Placed inside an <svg>.
 *
 * @param {{ x: number, y: number, size?: number, className?: string }} props
 */
export function Sparkle({ x, y, size = 1, className = art.fGold }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      <path d="M0 -8 Q1 -1 8 0 Q1 1 0 8 Q-1 1 -8 0 Q-1 -1 0 -8 Z" className={`${className} ${art.twinkle}`} />
    </g>
  );
}
