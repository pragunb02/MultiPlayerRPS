# Art pipeline

How pictures, sounds and fonts get into ClassiCade, and the licence rules they follow (CC-230). The research behind
these rules is in [tickets/CC-230.md](../tickets/CC-230.md). The record of every asset is
[CREDITS.md](../CREDITS.md).

## Adding an asset

1. **Prefer drawing in code.** Art is hand-drawn SVG in a React component under `apps/web/src/art/`, painted with CSS
   module classes over the design tokens, never a `style` attribute or a `<style>` element (ADR-012, the CSP). Use
   the `Svg` frame, which makes a drawing decorative without a `title` and a named image with one.
2. **A file only when code cannot do it:** a photo, a recorded sound, a font. Files go in `apps/web/public/` in a
   folder named after what they are (`pieces/`, `og/`, `sounds/`, `fonts/`).
3. **Add its row to [CREDITS.md](../CREDITS.md)** in the same pull request: file, what it is, author, licence (SPDX
   id), source (a link, or "Drawn for ClassiCade in CC-###") and the date it was added. `npm test` fails without it
   (`scripts/credits.test.mjs`), and also when a row names a file that was deleted or renamed.
4. Third party work keeps its licence text and notice beside the files (for example
   `apps/web/public/pieces/LICENSE.md`).

## Licence rules

| Licence (SPDX id)                          | Use it?                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `LicenseRef-ClassiCade`                    | Yes. Our own work, all rights reserved. Includes commissioned art once the copyright is ours. |
| `CC0-1.0`                                  | Yes. We credit it anyway.                                                                     |
| `CC-BY-4.0`                                | Yes, with the credit (title, author, source, licence) and a note when we changed it.          |
| `MIT`, `BSD-3-Clause`                      | Yes, keep the notice and licence text with the files.                                         |
| `OFL-1.1`                                  | Yes, for fonts.                                                                               |
| CC BY-SA (ShareAlike)                      | **No.** Our recolours and skins would have to be shared under the same licence.               |
| CC BY-NC (NonCommercial)                   | **No.** ClassiCade will earn money (cosmetics, Plus).                                         |
| CC BY-ND (NoDerivatives)                   | **No.** We recolour everything to the neon tokens.                                            |
| Unknown, "free", a screenshot from the web | **No.** No licence means no permission.                                                       |

When a work is offered under several licences, pick an allowed one and say which in the source column.

Bit is drawn by a person (ADR-024): no tracing, no copying, and no AI generated images. Other characters may start
from AI assisted drafts with human cleanup (ADR-024), but only once the owner is satisfied the tool's terms allow
commercial use, and the credit says so.

## Commissioned art

Before an artist is paid, they sign a written assignment of copyright. A lawyer drafts one reusable deed (owner's
task). Under India's Copyright Act 1957 it must be in writing and should say: the works, worldwide, for the full term
of copyright, all media, that the one year lapse in section 19(4) does not apply, the artist's consent to our
changes (recolour, resize, animate, crop, new poses), a promise that the work is original and not AI generated, and
the hand over of the editable SVG source. The artist stays named in the author column (their moral right to credit).
Details and caveats: [tickets/CC-230.md](../tickets/CC-230.md) section 4. This is general guidance, not legal advice.

## Size and format

1. **SVG files at most 20 KB each.** The test fails above it. Run the file through an optimiser (SVGO or the
   editor's "minify" export) and remove editor data, embedded bitmaps and fonts.
2. Art components stay small too: shared shapes go in one group, and poses or variants swap only the parts that
   change.
3. PNG or WebP only for things that cannot be vectors, at the size they are shown (twice that for sharp screens).
4. Sounds stay synthesised in `apps/web/src/lib/sound/sounds.js` unless a recording is really needed. A recorded
   sound is a short Ogg Opus or MP3 file, under 50 KB.
5. No external URLs. Every asset is served from our own origin (the CSP allows nothing else).

## Naming

1. Components: `PascalCase.jsx` named after what they draw (`HandRock.jsx`, `Bit.jsx`), one folder per family
   (`rps/`, `badges/`, `bit/`, later `characters/` for CC-194).
2. Files: lower case words with hyphens (`rock-paper-scissors.png`), except sets that follow an established
   naming (the chess pieces `wK.png`).
3. Poses and expressions use the names in [story/STORY_MODE.md](../story/STORY_MODE.md) section 3: `idle`,
   `happy`, `sad`, `thinking`, `surprised`, and `cheer` for Bit.

## Swapping in the artist's Bit

The current Bit (`apps/web/src/art/bit/Bit.jsx`) is a placeholder, credited as one in CREDITS.md. Its outside is
fixed so the swap changes no caller:

1. The artist draws the six poses on a 160 by 160 canvas, with the STORY_MODE.md brief, the neon inks and a 3 px ink
   outline, and delivers clean SVG (no embedded images or fonts) with a signed assignment.
2. A builder turns the drawing into the same component: the shapes replace the paths in `Bit.jsx`, colours become
   CSS module classes over tokens, and `pose`, `size`, `title`, `decorative` and `className` keep working.
   `BIT_POSES` and the accessible names in `bitPoses.js` stay.
3. `Bit.test.jsx` must pass unchanged (each pose renders and differs, the names, decorative mode, no style
   attribute, reduced motion).
4. The CREDITS.md row moves from "Placeholders to replace" to our own art, naming the artist as author, with the
   date and "Commissioned for ClassiCade, assignment signed YYYY-MM-DD" as the source.
