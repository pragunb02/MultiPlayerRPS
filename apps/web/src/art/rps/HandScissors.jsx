import { Svg } from "../Svg.jsx";
import { ScissorsGlyph } from "./hands.jsx";

/** @param {{ title?: string, className?: string }} props */
export function HandScissors({ title = "", className = "" }) {
  return (
    <Svg viewBox="0 0 64 64" title={title} className={className}>
      <ScissorsGlyph />
    </Svg>
  );
}
