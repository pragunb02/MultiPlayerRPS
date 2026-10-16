import { Svg } from "../Svg.jsx";
import { PaperGlyph } from "./hands.jsx";

/** @param {{ title?: string, className?: string }} props */
export function HandPaper({ title = "", className = "" }) {
  return (
    <Svg viewBox="0 0 64 64" title={title} className={className}>
      <PaperGlyph />
    </Svg>
  );
}
