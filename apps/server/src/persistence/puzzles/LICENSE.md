# Daily chess puzzles: source and licence

`chessPuzzles.json` holds 406 puzzles chosen from the **Lichess puzzle database**,
https://database.lichess.org/#puzzles, by `scripts/bin/curate-chess-puzzles.mjs` (CC-144, ADR-061). They were
taken on 2026-10-20 from the first 300,000 puzzles of the file published on 2026-10-05.

Lichess releases the database under the **Creative Commons CC0 1.0 Universal** public domain dedication
(https://creativecommons.org/publicdomain/zero/1.0/). Anyone may copy, change and share it, also commercially,
without asking. CC0 asks for no credit. We credit Lichess anyway, on the puzzle page and here.

What we keep of each puzzle: its Lichess id, the position (FEN), the moves (UCI), the rating and the theme names.
We leave out the game link, the opening, the play counts and the popularity. The puzzles stay on the server, and a
player sees a puzzle's moves only by finding them, or after the day's attempt has ended.
