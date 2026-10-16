import { Svg } from "../Svg.jsx";
import { RockGlyph } from "./hands.jsx";

/** @param {{ title?: string, className?: string }} props */
export function HandRock({ title = "", className = "" }) {
  return (
    <Svg viewBox="0 0 64 64" title={title} className={className}>
      <RockGlyph />
    </Svg>
  );
}
