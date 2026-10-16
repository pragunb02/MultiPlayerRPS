import { useId } from "react";

/**
 * The frame every piece of art is drawn in. With a `title` the picture means something (`role="img"`, named by
 * its title); without one it is decoration that screen readers skip. Colours come from CSS-module classes over
 * the design tokens — never a `style` attribute (strict CSP, ADR-012).
 *
 * @param {{ viewBox: string, title?: string, className?: string, width?: number | string, height?: number | string, children: import("react").ReactNode }} props
 */
export function Svg({ viewBox, title = "", className = "", width, height, children }) {
  const titleId = useId();
  const meaning = title === "" ? { "aria-hidden": "true" } : { role: "img", "aria-labelledby": titleId };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={width}
      height={height}
      className={className || undefined}
      focusable="false"
      {...meaning}
    >
      {title !== "" && <title id={titleId}>{title}</title>}
      {children}
    </svg>
  );
}
