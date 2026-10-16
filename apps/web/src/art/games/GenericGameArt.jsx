import { Placed } from "../Placed.jsx";
import { Sparkle } from "../Sparkle.jsx";
import { Svg } from "../Svg.jsx";
import art from "../art.module.css";
import { JoystickGlyph } from "./glyphs.jsx";
import styles from "./gameArt.module.css";

/**
 * Art for a game this build has no picture for yet (a new game deployed on the server first): a joystick.
 *
 * @param {{ title?: string, className?: string }} props
 */
export function GenericGameArt({ title = "", className = "" }) {
  return (
    <Svg viewBox="0 0 240 150" title={title} className={`${styles.art} ${className}`}>
      <circle cx="120" cy="78" r="56" className={`${art.fPrimary} ${art.faint}`} />
      <Placed x={80} y={34} scale={1.25} className={`${styles.primary} ${art.floatIn}`}>
        <JoystickGlyph />
      </Placed>
      <Sparkle x={190} y={34} />
      <Sparkle x={52} y={110} size={0.7} className={art.fAccent} />
    </Svg>
  );
}
