import { gameArtFor } from "./gameArt.js";

/**
 * The illustration for a game (a joystick for games without their own art). Decorative unless given a `title`.
 *
 * @param {{ gameId: string, title?: string, className?: string }} props
 */
export function GameArt({ gameId, title = "", className = "" }) {
  const { Art } = gameArtFor(gameId);
  return <Art title={title} className={className} />;
}
