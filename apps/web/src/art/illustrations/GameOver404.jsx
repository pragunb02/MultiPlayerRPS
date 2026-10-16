import { Sparkle } from "../Sparkle.jsx";
import { Svg } from "../Svg.jsx";
import art from "../art.module.css";
import styles from "./illustrations.module.css";
import { pixelsOf, pixelWidth } from "./pixelFont.js";

const WIDTH = 200;

/** A line of pixel text centred on the screen. */
function PixelText({ text, y, size, className }) {
  const left = (WIDTH - pixelWidth(text) * size) / 2;
  return (
    <g className={className}>
      {pixelsOf(text).map(({ x, y: row }) => (
        <rect
          key={`${x}-${row}`}
          x={left + x * size}
          y={y + row * size}
          width={size - 0.6}
          height={size - 0.6}
        />
      ))}
    </g>
  );
}

/**
 * An arcade screen reading GAME OVER 404, for the not-found page.
 *
 * @param {{ title?: string, className?: string }} props
 */
export function GameOver404({ title = "Arcade screen: game over, page not found", className = "" }) {
  return (
    <Svg viewBox="0 0 200 170" title={title} className={`${styles.illustration} ${className}`}>
      <rect x="8" y="4" width="184" height="134" rx="16" className={art.fPrimary} />
      <rect x="20" y="14" width="160" height="112" rx="8" className={art.fInk} />
      <g className={art.faint}>
        {[30, 50, 70, 90, 110].map((y) => (
          <rect key={y} x="20" y={y} width="160" height="1.5" className={art.fPrimarySoft} />
        ))}
      </g>
      <PixelText text="GAME" y={24} size={4} className={art.fAccent} />
      <PixelText text="OVER" y={58} size={4} className={art.fAccent} />
      <PixelText text="404" y={96} size={3} className={art.fGold} />
      <path d="M86 138 H114 L120 156 H80 Z" className={art.fPrimary} />
      <rect x="60" y="154" width="80" height="10" rx="5" className={art.fPrimary} />
      <Sparkle x={182} y={10} />
      <Sparkle x={14} y={150} size={0.7} className={art.fAccent} />
    </Svg>
  );
}
