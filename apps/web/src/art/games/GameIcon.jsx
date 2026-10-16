import { Svg } from "../Svg.jsx";
import { gameArtFor } from "./gameArt.js";
import styles from "./gameArt.module.css";

/**
 * A small glyph for a game (24 or 32 px), in the game's accent colour; a joystick for unknown games.
 * Decorative unless given a `title`.
 *
 * @param {{ gameId: string, size?: 24 | 32, title?: string, className?: string }} props
 */
export function GameIcon({ gameId, size = 24, title = "", className = "" }) {
  const { Glyph, tone } = gameArtFor(gameId);
  return (
    <Svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      title={title}
      className={`${styles.icon} ${styles[tone]} ${className}`}
    >
      <Glyph />
    </Svg>
  );
}
