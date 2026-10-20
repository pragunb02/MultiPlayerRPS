# Credits and licences for art, sound and fonts

Every picture, sound and font in ClassiCade, who made it, and under which licence we use it (CC-230). How to add
one, and the rules, are in [art/README.md](art/README.md).

`scripts/credits.test.mjs` reads the tables below. It fails when an asset file under `apps/web` (images, sounds,
fonts) or an art component under `apps/web/src/art` has no row, when a row names a file that no longer exists, when
a licence is not on the allowed list, and when an SVG file is larger than 20 KB.

Columns: **File** (path from the repository root), **What**, **Author**, **Licence** (an SPDX id), **Source** (where
it came from), **Added** (the date it came into this repository).

**`LicenseRef-ClassiCade`** means: copyright ClassiCade, all rights reserved. It is our own work, drawn or made
for ClassiCade by the owner or the builders, and is not offered to anyone under any licence. If an ADR later sets
different terms for our own art, those terms replace this paragraph.

## Placeholders to replace

| File                           | What                                                                                                                                          | Author     | Licence               | Source                                                                   | Added      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- | ------------------------------------------------------------------------ | ---------- |
| `apps/web/src/art/bit/Bit.jsx` | **Placeholder** Bit the mascot, six poses, drawn by hand in code from the STORY_MODE.md brief. To be replaced by an artist's drawing (CC-194) | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade in CC-230, no reference art traced or copied, no AI | 2026-10-18 |

## Third party art

The chess pieces are the "Cburnett" set. Colin M.L. Burnett offers them on Wikimedia Commons under four licences of
the user's choice (GFDL 1.2+, CC BY-SA 3.0, BSD 3 clause, GPL 2+). We use them under **BSD-3-Clause**, whose notice
and conditions are kept beside the files in `apps/web/public/pieces/LICENSE.md`. The PNGs are plain renders of the
Commons drawings that came with the legacy app (the chessboard.js "wikipedia" theme). Who rendered them is not
recorded, and a faithful render adds no new copyright.

| File                            | What              | Author             | Licence      | Source                                                         | Added      |
| ------------------------------- | ----------------- | ------------------ | ------------ | -------------------------------------------------------------- | ---------- |
| `apps/web/public/pieces/wK.png` | White king, PNG   | Colin M.L. Burnett | BSD-3-Clause | https://commons.wikimedia.org/wiki/File:Chess_klt45.svg (2006) | 2024-06-27 |
| `apps/web/public/pieces/wQ.png` | White queen, PNG  | Colin M.L. Burnett | BSD-3-Clause | https://commons.wikimedia.org/wiki/File:Chess_qlt45.svg (2006) | 2024-06-27 |
| `apps/web/public/pieces/wR.png` | White rook, PNG   | Colin M.L. Burnett | BSD-3-Clause | https://commons.wikimedia.org/wiki/File:Chess_rlt45.svg (2006) | 2024-06-27 |
| `apps/web/public/pieces/wB.png` | White bishop, PNG | Colin M.L. Burnett | BSD-3-Clause | https://commons.wikimedia.org/wiki/File:Chess_blt45.svg (2006) | 2024-06-27 |
| `apps/web/public/pieces/wN.png` | White knight, PNG | Colin M.L. Burnett | BSD-3-Clause | https://commons.wikimedia.org/wiki/File:Chess_nlt45.svg (2006) | 2024-06-27 |
| `apps/web/public/pieces/wP.png` | White pawn, PNG   | Colin M.L. Burnett | BSD-3-Clause | https://commons.wikimedia.org/wiki/File:Chess_plt45.svg (2006) | 2024-06-27 |
| `apps/web/public/pieces/bK.png` | Black king, PNG   | Colin M.L. Burnett | BSD-3-Clause | https://commons.wikimedia.org/wiki/File:Chess_kdt45.svg (2006) | 2024-06-27 |
| `apps/web/public/pieces/bQ.png` | Black queen, PNG  | Colin M.L. Burnett | BSD-3-Clause | https://commons.wikimedia.org/wiki/File:Chess_qdt45.svg (2006) | 2024-06-27 |
| `apps/web/public/pieces/bR.png` | Black rook, PNG   | Colin M.L. Burnett | BSD-3-Clause | https://commons.wikimedia.org/wiki/File:Chess_rdt45.svg (2006) | 2024-06-27 |
| `apps/web/public/pieces/bB.png` | Black bishop, PNG | Colin M.L. Burnett | BSD-3-Clause | https://commons.wikimedia.org/wiki/File:Chess_bdt45.svg (2006) | 2024-06-27 |
| `apps/web/public/pieces/bN.png` | Black knight, PNG | Colin M.L. Burnett | BSD-3-Clause | https://commons.wikimedia.org/wiki/File:Chess_ndt45.svg (2006) | 2024-06-27 |
| `apps/web/public/pieces/bP.png` | Black pawn, PNG   | Colin M.L. Burnett | BSD-3-Clause | https://commons.wikimedia.org/wiki/File:Chess_pdt45.svg (2006) | 2024-06-27 |

## Third party data

The daily chess puzzles (CC-144, ADR-061) are 406 puzzles from the Lichess puzzle database,
https://database.lichess.org/#puzzles, released by Lichess under **CC0-1.0**. They are kept on the server in
`apps/server/src/persistence/puzzles/chessPuzzles.json`, with the source and licence beside them in `LICENSE.md`.
The puzzle page credits Lichess. They are data, not art, so the table check above does not cover them.

## Our own image files

| File                                                  | What                                                                       | Author     | Licence               | Source                                                         | Added      |
| ----------------------------------------------------- | -------------------------------------------------------------------------- | ---------- | --------------------- | -------------------------------------------------------------- | ---------- |
| `apps/web/public/favicon.svg`                         | Browser tab icon, the joystick glyph (same as `LogoMark`)                  | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade in CC-087                                 | 2026-10-16 |
| `apps/web/public/favicon-turn.svg`                    | Tab icon with a gold badge while it is your turn                           | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade in CC-104                                 | 2026-10-16 |
| `apps/web/public/og/classicade.png`                   | Link preview card for the site (first release, kept online for old shares) | ClassiCade | LicenseRef-ClassiCade | Rendered from our own art by `apps/web/og/render.mjs` (CC-047) | 2026-10-16 |
| `apps/web/public/og/rock-paper-scissors.png`          | Link preview card for Rock Paper Scissors                                  | ClassiCade | LicenseRef-ClassiCade | Rendered from our own art by `apps/web/og/render.mjs` (CC-047) | 2026-10-16 |
| `apps/web/public/og/tic-tac-toe.png`                  | Link preview card for Tic-Tac-Toe                                          | ClassiCade | LicenseRef-ClassiCade | Rendered from our own art by `apps/web/og/render.mjs` (CC-047) | 2026-10-16 |
| `apps/web/public/og/chess.png`                        | Link preview card for Chess                                                | ClassiCade | LicenseRef-ClassiCade | Rendered from our own art by `apps/web/og/render.mjs` (CC-047) | 2026-10-16 |
| `apps/web/public/og/classicade.71b95fd0.jpg`          | Link preview card for the site, JPEG under 150 KB                          | ClassiCade | LicenseRef-ClassiCade | Rendered from our own art by `apps/web/og/render.mjs` (CC-217) | 2026-10-20 |
| `apps/web/public/og/rock-paper-scissors.801640cf.jpg` | Link preview card for Rock Paper Scissors, JPEG under 150 KB               | ClassiCade | LicenseRef-ClassiCade | Rendered from our own art by `apps/web/og/render.mjs` (CC-217) | 2026-10-20 |
| `apps/web/public/og/tic-tac-toe.fd57d332.jpg`         | Link preview card for Tic-Tac-Toe, JPEG under 150 KB                       | ClassiCade | LicenseRef-ClassiCade | Rendered from our own art by `apps/web/og/render.mjs` (CC-217) | 2026-10-20 |
| `apps/web/public/og/chess.b756bac7.jpg`               | Link preview card for Chess, JPEG under 150 KB                             | ClassiCade | LicenseRef-ClassiCade | Rendered from our own art by `apps/web/og/render.mjs` (CC-217) | 2026-10-20 |

## Our own art drawn in code

Hand-drawn SVG in React components (ADR-012). Frames and helpers are listed too, so the check can cover the whole
folder.

| File                                                    | What                                                    | Author     | Licence               | Source                         | Added      |
| ------------------------------------------------------- | ------------------------------------------------------- | ---------- | --------------------- | ------------------------------ | ---------- |
| `apps/web/src/art/Svg.jsx`                              | The frame every drawing sits in (no picture of its own) | ClassiCade | LicenseRef-ClassiCade | Written for ClassiCade, CC-087 | 2026-10-16 |
| `apps/web/src/art/Placed.jsx`                           | Places a glyph in a scene (no picture of its own)       | ClassiCade | LicenseRef-ClassiCade | Written for ClassiCade, CC-087 | 2026-10-16 |
| `apps/web/src/art/Logo.jsx`                             | The wordmark and the joystick glyph                     | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/HeroArt.jsx`                          | The home page hero scene, an arcade cabinet             | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/Sparkle.jsx`                          | A four point twinkling star                             | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/achievements/AchievementIcon.jsx`     | Achievement medals and their icons                      | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/badges/LevelBadge.jsx`                | Level badges by rank                                    | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/badges/Medal.jsx`                     | Tier medal                                              | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/effects/Confetti.jsx`                 | Win confetti                                            | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/effects/LevelUpBurst.jsx`             | Level up burst                                          | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/effects/StreakFlame.jsx`              | Streak flame                                            | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/effects/XpPop.jsx`                    | Floating XP number                                      | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/games/GameArt.jsx`                    | Game tile art chooser                                   | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/games/GameIcon.jsx`                   | Small game icons                                        | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/games/glyphs.jsx`                     | Shared game glyphs (knight, pawn, grid, joystick)       | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/games/RpsArt.jsx`                     | Rock Paper Scissors tile                                | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/games/TicTacToeArt.jsx`               | Tic-Tac-Toe tile                                        | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/games/ChessArt.jsx`                   | Chess tile                                              | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/games/GenericGameArt.jsx`             | Fallback tile for a game without art                    | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/illustrations/EmptyMatches.jsx`       | Empty match history illustration                        | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/illustrations/GameOver404.jsx`        | GAME OVER 404 screen                                    | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/illustrations/InviteArt.jsx`          | Invite a friend illustration                            | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/rps/hands.jsx`                        | Shared hand drawing for Rock Paper Scissors             | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/rps/HandRock.jsx`                     | Rock hand                                               | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/rps/HandPaper.jsx`                    | Paper hand                                              | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/rps/HandScissors.jsx`                 | Scissors hand                                           | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/tictactoe/MarkX.jsx`                  | Tic-Tac-Toe X                                           | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/art/tictactoe/MarkO.jsx`                  | Tic-Tac-Toe O                                           | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-087   | 2026-10-16 |
| `apps/web/src/components/SoundControl/SoundControl.jsx` | Speaker icon on the sound switch                        | ClassiCade | LicenseRef-ClassiCade | Drawn for ClassiCade, CC-103   | 2026-10-16 |

## Sounds

No sound files. Every sound is a few notes synthesised in the browser by `apps/web/src/lib/sound/sounds.js`
(CC-103), our own code (`LicenseRef-ClassiCade`). A recorded sound added later gets a row in a table above.

## Fonts

No font files. The app uses the system font stacks in `apps/web/src/styles/tokens.css` (ADR-012), which belong to
each player's operating system and are not shipped by us. A web font added later needs `OFL-1.1` or another allowed
licence and a row here.
