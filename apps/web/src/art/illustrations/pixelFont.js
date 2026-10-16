// A 5 × 7 pixel font with just the characters the art needs. "#" is a lit pixel.
const GLYPHS = Object.freeze({
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  0: [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
});

const ADVANCE = 6; // 5 pixels and a gap

/**
 * The lit pixels of `text`, in pixel units from its top-left corner.
 *
 * @param {string} text  characters from the font only
 * @returns {Array<{ x: number, y: number }>}
 * @throws {RangeError} for a character the font doesn't have
 */
export function pixelsOf(text) {
  return [...text].flatMap((char, index) => {
    const rows = GLYPHS[char];
    if (rows === undefined) {
      throw new RangeError(`no pixel glyph for "${char}"`);
    }
    return rows.flatMap((row, y) =>
      [...row].flatMap((cell, x) => (cell === "#" ? [{ x: index * ADVANCE + x, y }] : [])),
    );
  });
}

/** Width of `text` in pixels. @param {string} text */
export const pixelWidth = (text) => text.length * ADVANCE - 1;
