# Computer players: Rocky, Pip and Queen Vee

Written 2026-10-18 for the owner, from the code on `main` (`packages/games/src/bots/`,
`packages/shared/src/bots.js`, `apps/server/src/domain/bots/`). Decisions: [ADR-025](../DECISIONS.md) (identity and
rewards, with its 2026-10-18 amendment), [ADR-040](../DECISIONS.md) (how a bot is built) and
[ADR-041](../DECISIONS.md) (the chess engine).

## 1. Who they are

Each game has one character. A player picks a level with one tap on the game's page ("Play Rocky", CC-221), and
the room opens with the character already seated and the game started. A character is always labelled as a
computer, before the game and during it ("computer · Hard", "Rocky is a computer player"). It is never shown as a
person.

| Game                | Character | Tagline                    | Levels, easiest first         |
| ------------------- | --------- | -------------------------- | ----------------------------- |
| Rock Paper Scissors | Rocky     | Rock is life. Or is it?    | Easy, Hard                    |
| Tic-Tac-Toe         | Pip       | Loves a corner.            | Easy, Medium, Unbeatable      |
| Chess               | Queen Vee | Attacks first, asks later. | Beginner, Club player, Strong |

## 2. How each level chooses its move

Every bot sees exactly what a person's browser would see for its seat, never the hidden parts of the game. In Rock
Paper Scissors it never sees your throw before it throws. Its move goes through the same checks as yours, so it
cannot make an illegal move. Its randomness comes from the game's seed, so the same game always plays the same way
again, which is what makes games replayable and tests repeatable.

### Rocky (Rock Paper Scissors)

- **Easy** throws completely at random. There is no habit to find, so over many rounds nobody can do better than
  break even.
- **Hard** (the pattern reader) learns your habits during the game. It counts how often you throw each shape, and
  counts twice as much what you threw after the shape you just played ("after rock she plays paper"). It guesses
  your most likely throw and plays what beats it. One throw in five it picks at random anyway, so you cannot steer
  it by playing rock twice and then switching. It throws at random in the first round. Tested over 200 games each:
  it beats someone who always plays rock 198 times and someone who cycles rock, paper, scissors 176 times.
- Rocky has two levels, not three, because there are two RPS strategies. This is a default the owner may change.
- The pattern reader learns only from the current game, not from earlier games against you in the same room.

### Pip (Tic-Tac-Toe)

- **Easy** plays any free cell. When it could win at once, it notices only half the time.
- **Medium** takes a win if it has one, otherwise blocks yours, otherwise takes the centre, then a corner, then
  anything. A fork (two threats at once) beats it.
- **Unbeatable** looks at every possible rest of the game and plays a best move. It never loses, so a draw is the
  best you can do. When several moves are equally good it picks one at random so games vary, and it prefers to win
  sooner rather than later.

### Queen Vee (chess)

Queen Vee uses a small chess engine of our own (ADR-041). chess.js, the library the game itself uses, still checks
every move she makes.

- **Beginner** looks one move ahead and grabs free pieces, but 3 times in 10 she plays any legal move at all, and
  otherwise she misjudges each move by up to about eight tenths of a pawn. That is what makes her beatable for new
  players.
- **Club player** searches up to 3 moves deep and at most 20,000 positions a move. She plays sensible moves and
  spots short tactics.
- **Strong** searches up to 8 moves deep and at most 60,000 positions a move, with the usual engine tricks (looking
  further at captures and checks, trying the best moves first). She punishes mistakes. In tests Strong won 10 of 10
  games against Beginner, and Club won 10 of 10 against Beginner.
- **Fixed position budgets, not time limits.** Each level may look at a fixed number of positions, not a fixed
  number of milliseconds. So a level plays exactly the same on a fast laptop, a slow server and in a replay. On an
  Apple M4 Pro, Club answers in about 10 ms and Strong in about 140 ms on average, under the 300 ms target.
- Queen Vee never resigns, never offers a draw and never accepts one. A draw offer is declined at once.

## 3. Feeling human: the pause

Before every move, the server waits a short, random pause of 400 to 900 ms, so a computer does not answer
instantly. The pause is decided by the server, never by the bot, and is zero in tests.

## 4. Fair play limits

- **Never on a board.** Games against computers never count toward a chess rating or any leaderboard. XP from them is
  kept apart as `unrankedXp` and taken off every XP board.
- **At most 100 XP a day** from computer games (per UTC day). When a guest signs in, their computer-game XP moves only
  as far as the account still has room that day.
- **The usual game limits apply** (ADR-021): each character counts as one opponent for the 10 counted games per
  opponent in any 24 hours, and computer games count toward the 20 counted games per hour.
- **At most 3 games against computers at once** per player. Starting a fourth ends the oldest.
- **One chess search at a time on the whole server.** After each search the server rests as long as the search took,
  so computer players use at most half of the server's time and people's games stay fast.
- A room where only computers are still connected closes after the 2-hour away lifetime.
- Computers accept a person's rematch and never ask for one themselves.

## 5. The sealed RPS throw

Rock Paper Scissors is played at the same time, so a player could wonder whether Rocky looked at their throw first.
He cannot, and the player can check it:

1. Before you throw, Rocky's throw is sealed: the server sends a lock, a fingerprint (SHA-256) of Rocky's throw plus a
   secret key. The lock shows that Rocky has chosen, but not what.
2. After the round, the server shows Rocky's throw and the key. Your browser makes the fingerprint again and compares
   it with the lock it showed you before you threw.
3. If they match, the screen says the round was fair. If not, it warns you. A page opened after the lock was shown
   says it cannot check. The server itself also refuses a computer move that differs from its seal.

The proof is one press away in "How we keep it fair" for anyone who wants to check it with any SHA-256 tool. Plain
wording for players is CC-254 (PR #77).

## 6. What is planned

- **CC-190, story strategies.** New personalities for story mode ([story/STORY_MODE.md](../story/STORY_MODE.md)):
  favourite, copycat, cycle and win-stay for Rock Paper Scissors, blocker, corners and mirror for Tic-Tac-Toe, and a
  "stylist" for chess. The pattern reader may then also learn from earlier games in the room.
- **CC-051, quick match.** A character as the main Play button, with a search of at most 4 seconds for a person
  running in parallel, and a rating window for chess.
- **CC-150, adaptive difficulty.** Disclosed ("Rocky plays at your level"), changed only between games, with an off
  switch, and for minors and unknown ages based only on the current visit (ADR-025 point 5).
- **Bots for new games.** A new game adds one bot under `packages/games/src/bots/<game>/` that passes the contract
  kit, and one character in `BOT_CHARACTERS`. Nothing else changes.
- **Stronger chess** only if players ask for more than Strong. Stockfish could then sit behind the same contract.
