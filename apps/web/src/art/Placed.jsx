/**
 * Puts a glyph at a spot in a scene. The position is an SVG transform on the outer group; colour and motion
 * classes go on the inner group, because a CSS transform on an element replaces its SVG transform attribute.
 *
 * @param {{ x: number, y: number, scale?: number, className: string, children: import("react").ReactNode }} props
 */
export function Placed({ x, y, scale = 1, className, children }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className={className}>{children}</g>
    </g>
  );
}
