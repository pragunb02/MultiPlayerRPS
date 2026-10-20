/**
 * Colour contrast as WCAG 2.2 measures it (success criteria 1.4.3 and 1.4.11). Used by the token test and by the
 * design page, so both report the same numbers.
 */

const HEX = /^#([0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

/**
 * Reads a solid colour written as `#rrggbb` or as `rgb(r, g, b)`, the form a browser's computed style uses.
 *
 * @param {string} text
 * @returns {[number, number, number]} red, green and blue from 0 to 255
 * @throws {RangeError} for any other form, or a colour that is see-through, whose contrast depends on what is behind it
 */
export function parseColour(text) {
  const value = text.trim();
  const hex = HEX.exec(value);
  if (hex) {
    return [0, 2, 4].map((at) => Number.parseInt(hex[1].slice(at, at + 2), 16));
  }
  const rgb = RGB.exec(value);
  if (rgb && (rgb[4] === undefined || rgb[4] === "1" || rgb[4] === "100%")) {
    return [rgb[1], rgb[2], rgb[3]].map(Number);
  }
  throw new RangeError(`"${text}" is not a solid #rrggbb or rgb() colour`);
}

const channel = (value) => {
  const share = value / 255;
  return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
};

/** How bright a colour looks, from 0 for black to 1 for white. */
const luminance = (text) => {
  const [red, green, blue] = parseColour(text).map(channel);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

/**
 * The contrast ratio of two solid colours, from 1 (the same) to 21 (black on white).
 *
 * @param {string} first
 * @param {string} second
 * @returns {number}
 */
export function contrastRatio(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
