# ClassiCade Quest: story mode design (CC-179)

Written 2026-10-17. Design only, no code. It builds on the bot strategies on branch `cc-038-bot-strategies`
(`packages/games/src/bots/`), the game shell (ADR-020, proposed, see [docs/ux/MATCH_EXPERIENCE.md](../ux/MATCH_EXPERIENCE.md)),
the visual identity (ADR-012), the gamification rules (ADR-013) and player data that follows the identity (ADR-014).
Its decision record is ADR-024 (story mode), accepted with the owner's decisions in section 7. Tickets: CC-187 to
CC-202.

Contents:

1. Pitch, goals and success metrics
2. World and lore
3. Cast
4. Level design
5. Dialogue
6. Systems
7. Build plan and tests

---

## 1. Pitch, goals and success metrics

### Pitch

The ClassiCade arcade has gone dark. Every fair game played together makes a spark, and the sparks ran out when people
stopped playing. Bit, the arcade's little caretaker robot, still has one spark left and asks you for help. You travel
through three districts, Paper Town (Rock Paper Scissors), Grid City (Tic Tac Toe) and The Kingdom (Chess), learn each
game from scratch, beat a cast of rivals who each play in their own way, win a spark from each district champion and
carry the three sparks to the Marquee, the arcade's great sign. When it lights up, every character you met comes out
to cheer, and Bit hands you over to the real arcade: invite a friend or find a match.

Quest is a single player campaign against bots, played in the browser on desktop and phone, free for everyone,
including guests. It is the friendliest door into ClassiCade, and it ends by pointing at the multiplayer games.

### Goals

1. **Onboarding.** Teach every rule of every game step by step, with no reading required beyond two short lines at a
   time. Teach the platform on the way: the match bar, the result card, Rematch, emotes, hints, XP and levels, and
   saving progress by making an account.
2. **Retention.** Give new players a reason to come back tomorrow (the next rival, missing stars, the next district)
   without timers, energy, streak penalties or anything that punishes a day off.
3. **Brand.** Give the portal a face. Bit and the rivals make ClassiCade feel like a place with warmth and a sense of
   humour, not a list of games. The art follows ADR-012 so Quest looks like the rest of the arcade.
4. **A bridge to people.** Every district ends with an invitation to play the same game against a person. The finale
   ends on "Invite a friend" and "Play now".

### How it helps

| Area       | What Quest does                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onboarding | A visitor with no friend online and no account can play within 10 seconds of opening `/quest`. Tutorials teach the rules with real games, not pages of text.        |
| Learning   | Each rival is a lesson in disguise: Rocky teaches "play what beats a favourite", Blocky teaches forks, Castellan Rook teaches the two rook checkmate.               |
| Platform   | The second Paper Town level teaches Rematch and the series score. Hints, the result card, XP and the "save your stars" beat for guests all appear in context, once. |
| Retention  | 96 stars to collect, optional encore levels after the ending, a "next rival" teaser on the home page, and cosmetic rewards that show on the profile.                |
| Brand      | A mascot and 18 original characters in the neon arcade style, a short warm story and a shareable "Arcade relit" card.                                               |
| Conversion | Guests see one "Save your stars" beat after each district boss. Progress carries to the account (ADR-014), so nobody loses anything by signing up late.             |

### Success metrics

All numbers come from the first party telemetry (CC-173 to CC-178) and the server side product events (CC-045). The
targets are for the first 8 weeks after launch and are reviewed after 4 weeks.

| #   | Metric                                                                                         | Target                     |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| M1  | First time visitors who open Quest from the home page                                          | at least 25 %              |
| M2  | Quest starters who finish the first level (PT1)                                                | at least 85 %              |
| M3  | Quest starters who finish all Paper Town tutorials (PT1 and PT2)                               | at least 65 %              |
| M4  | Median time from opening `/quest` to the first finished match                                  | under 90 seconds           |
| M5  | D1 retention of Quest starters, compared with first time visitors who did not start Quest      | 5 points higher or more    |
| M6  | D7 retention of Quest starters, compared in the same way                                       | 3 points higher or more    |
| M7  | Paper Town finishers who play a human match (quick match or invite) within 7 days              | at least 20 %              |
| M8  | Guests who create an account at a "Save your stars" beat                                       | at least 8 %               |
| M9  | Quest starters who reach the finale within 30 days                                             | at least 10 %              |
| M10 | Finale finishers who share the "Arcade relit" card                                             | at least 10 %              |
| M11 | Players who skip a scene on its first showing                                                  | under 50 % (writing check) |
| M12 | Dead clicks and rage clicks on Quest screens, per 100 visits                                   | under 1                    |
| M13 | First try clear rate of each level, compared with its band in the difficulty curve (section 4) | inside the band            |

M5 and M6 are compared, not causal. If Quest starters retain better only because keen players start Quest, M7 tells
us whether Quest actually leads people into the multiplayer game.

---

## 2. World and lore

### The arcade

ClassiCade is an old arcade at the end of a long street. Its great sign, the Marquee, used to glow every night. The
arcade runs on sparks: a spark is made every time two players play a fair game and shake hands at the end. Over the
years people played less together, the sparks ran low and the lights went out, district by district. The characters
inside did not go anywhere. They just stopped playing, and each district champion now keeps the last spark of their
district safe in a glass bulb.

Bit, the caretaker robot, was built to sweep floors and polish buttons. It kept one spark in its chest, which is why
its antenna still glows. When you walk in, Bit wakes up and asks you to help relight the arcade.

### The districts

1. **Paper Town** (Rock Paper Scissors). A folded paper village with origami houses, paper lanterns and pinwheels on
   every roof. Everything here is folded, even the rules. The champion is Madame Origami, a great paper crane.
2. **Grid City** (Tic Tac Toe). A neon city built on a nine square grid, with glowing streets in rows, columns and
   diagonals. The champion is The Architect, a skyscraper robot who has never lost a game.
3. **The Kingdom** (Chess). A castle on a checkered hill, where the pieces live in little stone houses. The champion
   is King Oldwick, an old king who has not played anyone in years and misses it more than he says.
4. **The Marquee** (all three). The great sign above the arcade door. It lights up when the three sparks are home.

### The arc

1. Prologue: the dark arcade, Bit wakes up.
2. Paper Town: learn to read people. Win Madame Origami's spark.
3. Grid City: learn to plan ahead and block. Hold The Architect to a draw and earn his spark.
4. The Kingdom: learn chess one piece at a time. Win King Oldwick's spark.
5. The Marquee: one last friendly game of each against Bit, then the ending.
6. Ending: the Marquee lights up, every character cheers, and Bit says the arcade shines brightest with friends.
7. After the ending: encore levels, one per district, for players who want a real challenge.

Nobody in the story is a villain. Rivals are lonely, proud, silly or kind, and every one of them is happier after
playing you, whether you win or lose. That is the message of the whole story: playing together is the point.

---

## 3. Cast

### Art rules for every character (ADR-012)

1. Hand-drawn SVG React components in `apps/web/src/art/characters/`, one file per character, registered in a
   `CHARACTER_ART` map from character id to `{ Portrait, Figure }` with a fallback to Bit, like `GAME_ART`.
2. `viewBox="0 0 160 160"` for the figure, a 64 by 64 crop for the portrait (map nodes, the dialogue strip, avatars).
3. Flat fills from tokens only, painted with SVG presentation attributes and CSS module classes, never a `style`
   attribute. A 3 px outline in `--color-art-ink` on every shape, so each character reads on light and dark themes.
   One white highlight (`--color-glow-white`) per character, top left.
4. Characters use theme independent inks so they look the same in both themes: `--color-neon-rps`,
   `--color-neon-tictactoe`, `--color-neon-accent`, `--color-neon-gold`, `--color-neon-xp`, `--color-art-ink` and
   `--color-art-white`. Three new art only tokens are needed (same value in both themes):
   1. `--color-neon-chess: #b18cff` for The Kingdom (the dark theme value of `--color-game-chess`).
   2. `--color-art-stone: #9aa0b8` for stone and pebbles.
   3. `--color-art-fold: #e6e1d6` for the shaded side of paper folds.
5. Every character has five expressions: **idle**, **happy**, **sad**, **thinking** and **surprised**. They share one
   body. An expression swaps only the `<g>` groups for eyes, mouth, brows and one prop pose, so the five versions cost
   little more than one. The resting pose is idle.
6. Motion follows ADR-012 rule 3: only `transform` and `opacity`, at most 1.5 seconds, nothing loops forever. An
   expression change is a 120 ms cross fade and a small 4 px hop. With reduced motion the face changes and nothing
   moves.
7. No text inside the art. Names and lines are always real text next to the art.

Expression guide used by every brief below:

| Expression | Eyes                          | Mouth             | Body                                      |
| ---------- | ----------------------------- | ----------------- | ----------------------------------------- |
| idle       | open, relaxed                 | small smile       | resting pose                              |
| happy      | closed upward arcs            | wide open smile   | arms or prop raised, highlight brighter   |
| sad        | lids half down, outer corners | small down curve  | shoulders or prop lowered, no tears       |
| thinking   | one eye narrowed, looking up  | flat, to one side | hand or prop at the chin, three dot cloud |
| surprised  | wide round eyes               | small round "o"   | leaning back, two spark lines at the head |

Sad is gentle and brief. Nobody cries and nobody is ever angry.

### Bit, the guide

| Field        | Brief                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | The arcade's caretaker robot and the mascot of ClassiCade (base drawing from CC-153). Guide, tutor and the friendly opponent of the tutorials and the finale.                                                                                                                                                                                                                                                                   |
| Look         | A small arcade cabinet on two round wheels. Body: a rounded rectangle in `--color-primary` with an `--color-art-ink` outline. Face: the cabinet screen, a dark `--color-art-ink` panel with pixel square eyes and mouth in `--color-neon-xp`. Antenna: a joystick on its head with a glowing ball in `--color-neon-accent`. Two short arms that end in round arcade buttons (`--color-neon-gold` and `--color-neon-tictactoe`). |
| Expressions  | idle: square eyes, one pixel smile. happy: eyes become `^ ^`, the antenna ball glows (opacity pulse, three times). sad: eyes droop to two flat lines, the antenna tilts down and dims. thinking: three scrolling dots on the screen, joystick tilted to one side. surprised: eyes become two big pixel rings, two spark lines from the antenna. Extra story pose: **cheer** (both arms up) for the ending.                      |
| Personality  | Cheerful, curious, a little clumsy, never smug. Loves the arcade and every character in it. Celebrates your wins more than its own.                                                                                                                                                                                                                                                                                             |
| Catchphrases | "Beep! Nice one!" and "Every game makes a spark."                                                                                                                                                                                                                                                                                                                                                                               |
| Play style   | Tutorials: the gentlest levels of each bot (see the strategy table). Finale: a medium strength mix (section 3, strategy variants).                                                                                                                                                                                                                                                                                              |

### Paper Town (Rock Paper Scissors)

District palette: `--color-neon-rps` (orange), `--color-art-white` and `--color-art-fold` for paper.

| Character                 | Look (SVG brief)                                                                                                                                                                                                                                                       | Personality                                                                     | Catchphrases                                                     | Play style                                             | Difficulty |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ | ---------- |
| **Rocky**                 | A round pebble in `--color-art-stone` with two darker speckles, big cheeks, stubby arms. Wears a folded paper boat hat (`--color-art-white`, band in `--color-neon-rps`). Happy: hat tips up. Thinking: taps his own head, which sounds like a knock.                  | Proud, loyal and stubborn in a sweet way. Rock is his best friend.              | "Rock solid!" "Nothing beats a good rock. Well, almost nothing." | `favourite`: rock 60 % of the time                     | 1 of 10    |
| **Copycat**               | An origami cat folded from `--color-neon-accent` paper, fold lines in `--color-art-fold`, shiny round eyes, tail curled like a question mark. Surprised: ears fold flat. Happy: tail forms a heart.                                                                    | Playful and teasing but kind. Thinks copying is the highest form of friendship. | "Meow you see it!" "Whatever you do, I do. Mostly."              | `copycat`: throws your previous choice                 | 2 of 10    |
| **Whirly**                | A paper pinwheel on a stick, four blades in `--color-neon-rps`, `--color-neon-gold`, `--color-neon-accent` and `--color-neon-xp`, a button face in the middle. Happy: blades turn a quarter (one rotation, 360 ms). Sad: blades droop.                                 | Cheerful, energetic, loves routine. Goes round and round.                       | "Round and round!" "Rock, paper, scissors, repeat!"              | `cycle`: rock, paper, scissors in order                | 3 of 10    |
| **Lulu Lantern**          | A round paper lantern in `--color-neon-gold` with ribs in `--color-art-fold`, a tassel, two small paper hands. A soft glow behind her (a second circle at 30 % opacity). Sad: the glow dims. Happy: the tassel swings once.                                            | Superstitious and sunny. Believes in lucky moves and lucky days.                | "Lucky moves never change!" "Hmm, time for new luck."            | `win-stay`: keeps a winning throw, shifts after a loss | 4 of 10    |
| **Professor Crumple**     | A crumpled paper ball in `--color-art-white` with `--color-art-fold` creases, round glasses with `--color-art-ink` frames, a pencil in `--color-neon-gold` behind one ear, a small notebook. Thinking: writes in the notebook. Surprised: glasses jump up.             | Studious, polite, gets very excited about data. Counts your favourite throws.   | "Fascinating!" "My notes say... paper!"                          | `pattern`, counting favourites only, more surprises    | 5 of 10    |
| **Madame Origami** (boss) | A tall paper crane, layered wings in `--color-art-white` with `--color-neon-rps` edges, a crown of three folded stars in `--color-neon-gold`, long neck, calm half closed eyes. Happy: wings open wide. Thinking: one wing at the beak. Needs a large figure (240 px). | Graceful, wise, warm. Reads people gently and loves to be surprised.            | "Every fold tells a story." "Show me something new."             | `pattern` (the Pattern reader as shipped)              | 6 of 10    |

### Grid City (Tic Tac Toe)

District palette: `--color-neon-tictactoe` (teal), `--color-neon-xp` and `--color-art-ink` for the night grid.

| Character                | Look (SVG brief)                                                                                                                                                                                                                                             | Personality                                                                             | Catchphrases                                                   | Play style                                           | Difficulty |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- | ---------- |
| **Dot**                  | A small rounded square pixel in `--color-neon-tictactoe`, two tiny legs, one antenna with a dot on top. Happy: a bounce (4 px up and down, once). Surprised: becomes slightly taller.                                                                        | Young, excited, easily distracted. Misses things, then laughs.                          | "Boop!" "Wait, was that a win? Oops!"                          | `easy` (as shipped)                                  | 2 of 10    |
| **Blocky**               | A cube robot, front face in `--color-neon-xp`, sides in `--color-art-ink`, two big flat hands held up like stop signs in `--color-neon-accent`. Happy: hands thump together. Sad: hands drop.                                                                | Calm, steady, a good guard. Means well and takes his job seriously.                     | "Not on my watch!" "Blocked!"                                  | `blocker`: wins, blocks, otherwise anywhere          | 3 of 10    |
| **Cornelius**            | A tall thin robot with an L shaped hat brim (a corner), a monocle in `--color-neon-gold`, a bow tie in `--color-neon-tictactoe`. Thinking: adjusts the monocle. Surprised: monocle pops out.                                                                 | Fussy, polite, a collector. Corners are his treasures.                                  | "Corners, please!" "A corner a day keeps the losses away."     | `corners`: corners first, sometimes forgets to block | 4 of 10    |
| **Mira**                 | A symmetrical robot whose face is a mirror panel in `--color-art-white` with two diagonal `--color-neon-xp` reflection stripes, arms exactly the same on both sides. Happy: the reflection sweeps once. Thinking: tilts the head to one side.                | Elegant, a bit dreamy, loves balance.                                                   | "Left is right, right is left!" "Perfectly balanced."          | `mirror`: plays the cell opposite your last move     | 5 of 10    |
| **Nova**                 | A five pointed star made of neon tube in `--color-neon-accent`, a smiling face in the middle, roller skates in `--color-neon-gold`. Happy: the outline flickers once. Surprised: spins a quarter turn.                                                       | Speedy, confident, a good sport.                                                        | "Shine time!" "Fast and bright!"                               | `medium` (as shipped)                                | 6 of 10    |
| **The Architect** (boss) | A skyscraper robot with lit window squares in `--color-neon-gold`, a cape printed with a blueprint grid (`--color-neon-xp` lines on `--color-art-ink`), a hard hat, a set square in one hand. Large figure (240 px). Happy: all windows light up in a sweep. | Calm, precise, respectful. Has never lost, and admires anyone who does not lose to him. | "Every line has a plan." "A draw against me is a masterpiece." | `unbeatable` (as shipped)                            | 8 of 10    |

### The Kingdom (Chess)

District palette: `--color-neon-chess` (new, violet), `--color-neon-gold`, `--color-art-stone`.

| Character               | Look (SVG brief)                                                                                                                                                                                                                                       | Personality                                                                | Catchphrases                                                 | Play style                                                    | Difficulty |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- | ---------- |
| **Sir Pawnsley**        | A pawn shaped piece in `--color-art-white` wearing a tin helmet with a visor and a `--color-neon-chess` plume, holding a cardboard sword. Surprised: the visor drops shut. Happy: sword held high.                                                     | Brave, clumsy, earnest. Dreams of becoming a queen one day.                | "Onward, one square at a time!" "Oh no, my brave piece!"     | `beginner` (as shipped), plays without his queen              | 4 of 10    |
| **Duchess Diagonal**    | A tall bishop shaped piece in `--color-neon-chess` with a diagonal striped sash in `--color-neon-gold` and a folding fan. Happy: fan opens. Thinking: fan at the chin.                                                                                 | Dramatic, graceful, a little vain about her diagonals.                     | "Why go straight when you can glide?" "Diagonally yours."    | `stylist`: Beginner that prefers bishop moves                 | 5 of 10    |
| **Hopscotch**           | A knight shaped pony with a springy curled tail and a mane in `--color-neon-rps`, mid hop. Happy: a hop with all hooves off the ground. Surprised: mane stands up.                                                                                     | A joker who loves surprises and attacking two things at once.              | "Hop, hop, fork!" "Over the top!"                            | `stylist`: Beginner that prefers knight moves, fewer blunders | 5 of 10    |
| **Castellan Rook**      | A round castle tower in `--color-art-stone` with a door for a mouth, two arrow slit eyes, a `--color-neon-chess` flag on top. Thinking: flag droops sideways. Happy: flag waves once.                                                                  | Steady, protective, fair. Lends you her rooks to teach you.                | "Walls up!" "Climb the ladder, if you can."                  | `strong` (as shipped), defending a lone king                  | 6 of 10    |
| **Queen Quill**         | A queen shaped piece in `--color-neon-chess` with a crown in `--color-neon-gold`, holding a long quill in `--color-neon-xp`, a small open book. Thinking: quill at the lips. Happy: book snaps shut.                                                   | Clever and playful. Writes a new puzzle every day and loves a good riddle. | "A puzzle a day!" "Two moves. No more, no less."             | `strong` (as shipped), defending puzzle positions             | 7 of 10    |
| **King Oldwick** (boss) | An old king piece with a long beard of white yarn (`--color-art-white`), a crown in `--color-neon-gold` that is dim (50 % opacity) until you win his spark, a cane. Large figure (240 px). Sad is his idle at first. Happy: crown brightens and tilts. | Wise, gruff on the outside and warm inside. Lonely since nobody visits.    | "Hmph. A game, then." "I'd forgotten how good a game feels." | `club` (as shipped), plays without his queen                  | 7 of 10    |

### Strategy variants

The shipped bots stay exactly as they are. Quest adds parameters to two of them and a few new strategies. Every new
strategy follows the bot contract in `bots/bot.js`: pure, decides only from the seat's `view` and `history`, uses only
the injected `rng`, never reads the opponent's pending choice. Quest strategies are new bot levels with a new field
`listed: false`, so they never appear on the difficulty picker. They are only reachable through a Quest level.

**Parameters for existing strategies.** The constants in `rpsBot.js` and `chessBot.js` become per level settings with
the shipped values as defaults, so the shipped levels play exactly as today.

| Strategy id      | Base           | Parameters (shipped value in brackets)                                          | Used by                         |
| ---------------- | -------------- | ------------------------------------------------------------------------------- | ------------------------------- |
| `pattern`        | Pattern reader | `surpriseRate` (0.2), `habitWeight` (2)                                         | Madame Origami (shipped values) |
| `pattern-notes`  | Pattern reader | `surpriseRate: 0.35`, `habitWeight: 0` (counts favourites only, ignores habits) | Professor Crumple               |
| `pattern-gentle` | Pattern reader | `surpriseRate: 0.3`, `habitWeight: 1`                                           | Bit in the finale (MQ1)         |
| `pattern-sharp`  | Pattern reader | `surpriseRate: 0.1`, `habitWeight: 3`                                           | Madame Origami encore (PT9)     |
| `beginner`       | Chess Beginner | `blunderRate` (0.3), `noise` (80 hundredths of a pawn)                          | Sir Pawnsley, Bit in KG1 to KG3 |
| `club`, `strong` | Chess search   | `maxDepth` and `maxNodes` as in `CHESS_SEARCH_LIMITS`                           | Oldwick, Castellan, Quill       |

**New strategies.**

| Strategy id | Game  | Rule, in order                                                                                                                                                                                               | Parameters                                            | Property tests (seeded rng, 10,000 turns)                                                             |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `favourite` | RPS   | With probability `favouriteRate` throw `favourite`. Otherwise throw one of the other two, each equally likely.                                                                                               | `favourite: "rock"`, `favouriteRate: 0.6`             | rock between 57 % and 63 %, paper and scissors each between 17 % and 23 %                             |
| `copycat`   | RPS   | First round of the match: random. After that, with probability `mirrorRate` throw the opponent's choice from the last resolved round (draws included), otherwise random.                                     | `mirrorRate: 0.85`                                    | equals the opponent's last choice in 88 % to 92 % of rounds (random also matches a third of the time) |
| `cycle`     | RPS   | First round: random. After that, with probability `slipRate` repeat its own last choice, otherwise throw the next choice in `order` after its own last choice.                                               | `order: rock, paper, scissors`, `slipRate: 0.1`       | follows the order in 88 % to 92 % of rounds                                                           |
| `win-stay`  | RPS   | First round: random. If it won the last round, repeat its choice with probability `stayRate`. If it lost or drew, throw what beats the opponent's last choice with probability `stayRate`. Otherwise random. | `stayRate: 0.8`                                       | after a win repeats in 84 % to 88 % (random repeats a third of the time)                              |
| `practice`  | TTT   | Any free cell, at random. Never looks for wins or blocks. Bit uses it in GC1 so the first game is about finding lines, not about losing.                                                                     | none                                                  | never completes a line when another free cell exists                                                  |
| `blocker`   | TTT   | Win if it can. Block if the opponent can win next. Otherwise any free cell at random (no centre or corner preference, which is the only difference from `medium`).                                           | none                                                  | always wins when it can, always blocks a single threat                                                |
| `corners`   | TTT   | Win if it can. Block with probability `blockRate`. Otherwise the first free corner in the order 0, 2, 6, 8 (ties between remaining corners at random), then the centre, then any edge.                       | `blockRate: 0.75`                                     | blocks at least 72 % of single threats, opens on a corner every time                                  |
| `mirror`    | TTT   | Win if it can. Block if it must. Otherwise the cell opposite the opponent's last move (cell `8 - last`) if it is free, otherwise the `medium` order. Needs the last move in the view (CC-189).               | none                                                  | answers a corner with the opposite corner whenever nothing is at stake                                |
| `stylist`   | Chess | Beginner, but every move made by a piece of type `favouritePiece` gets `bonus` added to its score before the noise and the pick. Blunders keep their own rate.                                               | `favouritePiece`, `bonus: 40`, `blunderRate`, `noise` | moves the favourite piece in a clearly higher share of turns than plain Beginner                      |

Duchess Diagonal uses `stylist` with `favouritePiece: "bishop"`, `blunderRate: 0.2`, `noise: 60`. Hopscotch uses
`favouritePiece: "knight"`, `blunderRate: 0.15`, `noise: 60`.

Bots move after a short thinking pause so the game feels alive. The pause is presentation only, it never changes the
move: 400 to 900 ms in Paper Town and Grid City, 600 to 1,500 ms in The Kingdom. Bosses pause a little longer before
important moves (a capture or a check) to build suspense.

---

## 4. Level design

### Shape of the campaign

```
Prologue
   │
Paper Town ── PT1 tutorial ── PT2 tutorial ── PT3 Rocky ── PT4 Copycat ── PT5 Whirly ── PT6 Lulu ── PT7 Crumple ── PT8 Madame Origami ★ spark
   │
Grid City ─── GC1 tutorial ── GC2 tutorial ── GC3 Dot ── GC4 Blocky ── GC5 Cornelius ── GC6 Mira ── GC7 Nova ── GC8 The Architect ★ spark
   │
The Kingdom ─ KG1 to KG4 tutorials ── KG5 Pawnsley ── KG6 Duchess ── KG7 Hopscotch ── KG8 Castellan ── KG9 Quill ── KG10 King Oldwick ★ spark
   │
The Marquee ─ MQ1 ── MQ2 ── MQ3 ── Ending
   │
Encores (after the ending): PT9, GC9, KG11
```

| District    | Tutorials | Rivals | Boss | Encore | Levels | Stars  |
| ----------- | --------- | ------ | ---- | ------ | ------ | ------ |
| Paper Town  | 2         | 5      | 1    | 1      | 9      | 27     |
| Grid City   | 2         | 5      | 1    | 1      | 9      | 27     |
| The Kingdom | 4         | 5      | 1    | 1      | 11     | 33     |
| The Marquee | 0         | 3      | 0    | 0      | 3      | 9      |
| **Total**   | 8         | 18     | 3    | 3      | **32** | **96** |

29 levels lead to the ending. The 3 encores are optional.

### Rules that apply to every level

1. **Unlocking.** A level opens when the level before it is cleared or passed. The next district opens when its boss
   is cleared or passed. Stars never gate progress, so nobody has to grind.
2. **Stars.** Each level has three stars: ★ the goal, ★★ a "fast" rule and ★★★ a "clean" rule. Every star needs the
   goal to be met in that same attempt. Stars are kept forever and collected across attempts, so you can earn the fast
   star in one attempt and the clean star in another.
3. **Mistakes** (the clean star) are measured the same way everywhere in a game:
   1. Rock Paper Scissors: losing a round, unless the level says otherwise.
   2. Tic Tac Toe: you could win at once and played elsewhere, or the rival could win next move and you did not block.
   3. Chess: a move that gives away at least two and a half pawns of value compared with your best move, judged by a
      two move deep search after the game (the same `search.js` the bots use, with a fixed node budget, so the judgement
      is the same every time).
4. **Hints.** Every level has a free Hint button. Unlimited, never sold. A hint costs only the clean star in tutorials
   and puzzles (where "no hint" is the clean rule), and nothing elsewhere. Hints are:
   1. Rock Paper Scissors: Bit explains the rival's habit in plain words (from the level script).
   2. Tic Tac Toe: the cell a perfect player would choose is highlighted.
   3. Chess: the piece to move glows first, a second press shows the square.
5. **Patience, not punishment.** After three attempts without clearing a level, Bit offers a hint before the next
   game. After five, a **Pass** button appears: the level is marked passed with no stars and the next one opens. Passed
   levels show a hollow node and can be cleared later. Bosses can be passed too, so every child can see the ending.
6. **Move limits** keep chess levels finite. Reaching the limit ends the game kindly ("The candles burned down. Let's
   rest and try again.") and counts as not cleared, never as a loss.
7. **Who plays which side** is fixed by the level, not random: in chess you are White unless a level says otherwise.
8. **Clocks.** Chess levels are untimed (new `untimed` time control for bot rooms, CC-189). Only GC7 has a move timer,
   and the "Extra time" setting (section 6) triples it without costing a star.
9. **Stages.** Some levels have several stages (puzzle sets, two game series). Stages are played as consecutive games
   in one room, like a rematch. A stage you fail can be retried at once with Try again.

### Paper Town

| Id  | Title            | Rival             | Goal                                                          | Twist                                                                                      | ★★ Fast                      | ★★★ Clean                                         | Teaching point                                               | Reward                                         |
| --- | ---------------- | ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| PT1 | First throw      | Bit (`random`)    | Win a best-of-3                                               | The rule card stays on screen (rock beats scissors, scissors beat paper, paper beats rock) | Within 3 rounds, draws count | Throw rock, paper and scissors at least once each | The three rules, draws are replayed                          | 20 XP                                          |
| PT2 | Again!           | Bit (`random`)    | Play a best-of-3, press Rematch, play again, win at least one | Bit always accepts the rematch at once                                                     | Win both matches             | Lose no round in the second match                 | Rematch, the series score in the match bar, the result card  | 20 XP                                          |
| PT3 | Rock solid       | Rocky             | Win a best-of-3                                               | none                                                                                       | Within 3 rounds              | Lose no round                                     | Spot a favourite and play what beats it                      | Rocky avatar                                   |
| PT4 | Copy that        | Copycat           | Win a best-of-3                                               | none                                                                                       | Within 3 rounds              | Lose no round                                     | Your own habits are someone's plan: beat your own last throw | Copycat avatar                                 |
| PT5 | Round and round  | Whirly            | Win a best-of-5                                               | Scissors are out of stock: you cannot throw scissors                                       | Within 6 rounds              | Lose no round                                     | Predict a cycle and plan around a missing choice             | Whirly avatar                                  |
| PT6 | Lucky lights     | Lulu Lantern      | Win a best-of-5 within 7 rounds                               | A round limit: 7 rounds in total, draws included                                           | Within 5 rounds              | Lose no round                                     | Think two steps: what will she do after this round?          | Lulu avatar                                    |
| PT7 | Taking notes     | Professor Crumple | Win a best-of-5                                               | His notebook is open: it shows how often you threw each choice                             | Within 6 rounds              | Never throw the same choice three times in a row  | Pattern readers see favourites, so mix it up                 | Crumple avatar                                 |
| PT8 | The paper crane  | Madame Origami    | Win a best-of-5                                               | The fold board shows both players your last three throws                                   | Within 6 rounds              | Never throw the same choice three times in a row  | Be unpredictable on purpose                                  | Paper Town badge, Origami hand skin, the spark |
| PT9 | Origami unfolded | Madame Origami    | Win a best-of-7 (encore)                                      | She reads habits faster and rarely surprises (`pattern-sharp`)                             | Within 8 rounds              | Lose at most one round                            | True randomness is hard for people, and that is the lesson   | Paper Crane avatar frame                       |

### Grid City

Cells are numbered 0 to 8, left to right and top to bottom. In the boards below `X` and `O` are marks, `.` is free and
`#` is a closed cell that nobody can use.

| Id  | Title            | Rival            | Goal                                                         | Twist                                                                                    | ★★ Fast                      | ★★★ Clean   | Teaching point                                          | Reward                                      |
| --- | ---------------- | ---------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------- | ----------- | ------------------------------------------------------- | ------------------------------------------- |
| GC1 | Three in a row   | Bit (`practice`) | Make a line of three                                         | You are X and go first, the eight lines glow once at the start                           | In 3 moves                   | No hint     | Rows, columns and both diagonals                        | 20 XP                                       |
| GC2 | Block!           | Bit (`medium`)   | Win from the start board `OO. / .X. / ..X`, you to move as X | A start position where Bit threatens the top row                                         | Win in 2 moves               | No hint     | Block first, and a block can make two threats at once   | 20 XP                                       |
| GC3 | Boop!            | Dot              | Win a game (draws replay, up to 5 games)                     | none                                                                                     | Win in 4 moves or fewer      | No mistakes | Take a win the moment you see it                        | Dot avatar                                  |
| GC4 | Not on my watch  | Blocky           | Win a game (up to 5 games)                                   | none                                                                                     | Win in 4 moves or fewer      | No mistakes | A fork: two threats with one move                       | Blocky avatar                               |
| GC5 | Corner collector | Cornelius        | Win a game as O (up to 5 games)                              | Cornelius always goes first                                                              | Win in the first game        | No mistakes | Answer a corner with the centre, and how to play second | Cornelius avatar                            |
| GC6 | Mirror, mirror   | Mira             | Win 2 games before losing 2                                  | The centre is closed for repairs (start board `... / .#. / ...`)                         | Win 2 games in a row         | No mistakes | Without a centre, edges first set up a corner fork      | Mira avatar                                 |
| GC7 | Speed lights     | Nova             | Win 2 games before losing 2, you alternate who starts        | 5 seconds a move (15 with Extra time). When time runs out, a free cell is picked for you | Win 2 to 0                   | No mistakes | Plan quickly: centre, corners, then look for forks      | Nova avatar                                 |
| GC8 | The blueprint    | The Architect    | Two games without losing: one as X, one as O                 | He plays perfectly, so a draw is the best anyone can do                                  | No hint                      | No mistakes | Perfect play on both sides always ends in a draw        | Grid City badge, Neon Grid board, the spark |
| GC9 | Master plans     | The Architect    | Solve three "win in 2" boards (encore)                       | Stages: `XOX / ... / O..`, `XXO / O.. / ...` and `X.. / ... / OXO`, you to move as X     | Every stage on the first try | No hint     | Find the one move that makes two threats                | Circuit avatar frame                        |

Each GC9 board has exactly one winning move (cells 8, 4 and 1), checked by a full game tree search while writing this
document. GC2's start board wins only by blocking at cell 2, which also makes two threats.

### The Kingdom

Start positions are in FEN (the standard text form of a chess position), you play White. Every position below was
checked as legal with chess.js, and every puzzle solution was checked by an exhaustive search while writing this
document.

| Id   | Title                | Rival                   | Goal                                                               | Twist (start position)                                                                                                                                             | ★★ Fast                      | ★★★ Clean                             | Teaching point                                                                           | Reward                                       |
| ---- | -------------------- | ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| KG1  | Pawn race            | Bit (`beginner`)        | Promote a pawn before Bit does                                     | Only kings and pawns: `4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1`                                                                                                | Within 15 moves              | No hint                               | Pawns: forward, two squares on the first move, capture diagonally, promotion, en passant | 20 XP                                        |
| KG2  | Straight and slanted | Bit (`beginner`)        | Capture all three pawns within 20 moves                            | Rook and bishop against a king and three pawns: `7k/8/p2p2p1/8/8/8/8/R1B1K3 w - - 0 1`                                                                             | Within 10 moves              | Never leave a piece the king can take | The rook goes straight, the bishop diagonally and stays on its colour                    | 20 XP                                        |
| KG3  | Hops and the queen   | Bit (`beginner`)        | Capture all four pawns within 20 moves without losing a piece      | Knight and queen against a king and four pawns: `4k3/8/p1p2p1p/8/8/8/8/1N1QK3 w - - 0 1`                                                                           | Within 12 moves              | No hint                               | The knight's L jump over anything, the queen moves like a rook and a bishop              | 20 XP                                        |
| KG4  | Check and mate       | Bit (`strong`)          | Checkmate in one move, three stages                                | `6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1` (rook), `k7/8/1K6/8/8/8/8/2Q5 w - - 0 1` (queen), `6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1` (knight)                                 | Every stage on the first try | No hint                               | Check, escape squares, checkmate                                                         | 20 XP                                        |
| KG5  | Onward!              | Sir Pawnsley            | Capture 10 points of pieces, or checkmate, before move 30          | Full start, Sir Pawnsley has no queen: `rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`                                                                  | Before move 20               | No mistakes                           | Piece values (pawn 1, knight 3, bishop 3, rook 5, queen 9), free pieces, castling        | Pawnsley avatar                              |
| KG6  | Diagonally yours     | Duchess Diagonal        | Checkmate within 60 moves                                          | Full start, even material                                                                                                                                          | Within 40 moves              | No mistakes                           | Bring every piece out, watch the long diagonals, then go for the king                    | Duchess avatar                               |
| KG7  | Hop, hop, fork       | Hopscotch               | Promote a pawn or checkmate within 40 moves                        | Knights and pawns only: `1n2k1n1/pppppppp/8/8/8/8/PPPPPPPP/1N2K1N1 w - - 0 1`                                                                                      | Within 25 moves              | No mistakes                           | Forks: one knight attacking two pieces                                                   | Hopscotch avatar                             |
| KG8  | The ladder           | Castellan Rook          | Checkmate within 15 moves (stalemate is a draw and does not count) | Two rooks against a lone king: `8/8/3k4/8/8/8/8/R3K2R w - - 0 1`                                                                                                   | Within 8 moves               | Never lose a rook                     | The two rook ladder, and stalemate                                                       | Castellan avatar                             |
| KG9  | Quill's puzzles      | Queen Quill             | Checkmate in two moves, three stages                               | `4k3/8/8/8/8/8/8/R3K2R w - - 0 1` (key Ra7 or Rh7), `7k/8/5K2/8/8/8/8/Q7 w - - 0 1` (four keys), `5r1k/6pp/7N/3Q4/8/8/8/6K1 w - - 0 1` (only Qg8+, smothered mate) | Every stage on the first try | No hint                               | Checks first, but look for quiet moves and sacrifices too                                | Quill avatar                                 |
| KG10 | The old king         | King Oldwick            | Checkmate within 80 moves                                          | Full start, Oldwick has no queen (same FEN as KG5), plays `club`                                                                                                   | Within 50 moves              | No mistakes                           | Putting it all together                                                                  | Kingdom badge, Castle Stone board, the spark |
| KG11 | Full strength        | King Oldwick (`strong`) | Do not lose: a win or a draw (encore)                              | Full start, even material                                                                                                                                          | Win                          | Win with no mistakes                  | A real game against a strong opponent                                                    | Crown avatar frame                           |

### The Marquee

| Id  | Title          | Rival                  | Goal                                                   | Twist                                                  | ★★ Fast                  | ★★★ Clean     | Teaching point                       | Reward                                                                                    |
| --- | -------------- | ---------------------- | ------------------------------------------------------ | ------------------------------------------------------ | ------------------------ | ------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| MQ1 | Paper spark    | Bit (`pattern-gentle`) | Win a best-of-3                                        | none                                                   | Within 3 rounds          | Lose no round | Everything from Paper Town           | 40 XP                                                                                     |
| MQ2 | Grid spark     | Bit (`medium`)         | Win a game, Bit starts every game (up to 6 games)      | You play O                                             | Win in the first 2 games | No mistakes   | Everything from Grid City            | 40 XP                                                                                     |
| MQ3 | The quiet move | Bit (`strong`)         | Checkmate in two from `k7/8/2K5/8/8/8/8/1R6 w - - 0 1` | The only winning first move is the quiet king move Kc7 | First try                | No hint       | The best move does not always attack | 40 XP, the ending, "Arcade Relit" badge, Bit avatar, Marquee profile banner, encores open |

### Rewards summary

| Reward                 | How                                                                                                                             | System                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| XP for a first clear   | Tutorials 20, rivals 30, bosses 60, finale levels 40, encores 30. Once per level, ever.                                         | progression, source `story`                |
| XP for each new star   | 10 per star the first time it is earned                                                                                         | progression, source `story`                |
| Character avatars      | Clearing a rival or boss level unlocks that character's portrait as a preset avatar                                             | CC-143 unlocks, CC-034 avatars             |
| Board themes and skins | Origami hand skin (RPS), Neon Grid board (TTT), Castle Stone board (chess), at each boss                                        | CC-143 unlocks                             |
| Avatar frames          | Paper Crane, Circuit and Crown frames for the encores, plus an animated frame per district for all 27 or 33 stars               | CC-143 unlocks                             |
| Badges                 | Paper Town Hero, Grid City Hero, Kingdom Hero, Arcade Relit, Star Collector (one district at full stars), Quest Legend (all 96) | achievements (ADR-013: status only, no XP) |

Total story XP is at most 1,960 (1,000 for first clears and 960 for stars), about level 9. It can never be earned
twice, so it cannot be farmed. Story matches are bot matches, so the normal bot match XP of ADR-025 also applies, with
its caps, and they never count on the leaderboards. Nothing in Quest can be bought, and no reward changes how a game
plays. Every reward is cosmetic (avatars, frames, board themes and skins) or a badge, and Quest gives no coins (owner
decision 2). Story XP raises the player's level but is never added to the weekly leaderboard (owner decision 3).

CC-156 tie in: the "next unlock" teaser under the XP bar includes the next Quest reward ("Clear Whirly to unlock the
Whirly avatar"). Encore levels are the natural home for a one time taste of an upcoming variant (a single Lizard Spock
round in Paper Town, a 4 by 4 board in Grid City) once those variants exist, without unlocking them early.

### Difficulty curve

Difficulty is on a 1 to 10 scale. The band is the share of players we expect to clear the level on the first try.
Telemetry (M13) checks each level against its band, and a level outside its band for two weeks gets retuned by
changing its parameters, never its story.

```
Difficulty
10 |                                                                                         KG11
 9 |
 8 |                                    GC8                                         KG10
 7 |                                                                          KG9            PT9 GC9
 6 |                       PT8                          GC7                 KG8
 5 |                  PT7                         GC6                 KG6 KG7
 4 |             PT6                        GC5                 KG5
 3 |         PT5                      GC4                 KG4                        MQ3
 2 |     PT3 PT4                GC3               KG2 KG3                      MQ1 MQ2
 1 | PT1 PT2              GC1 GC2              KG1
   +-----------------------------------------------------------------------------------------
     Paper Town           Grid City            The Kingdom                   Marquee  Encores
```

| Band         | Levels                            | First try clear rate |
| ------------ | --------------------------------- | -------------------- |
| Tutorial     | PT1, PT2, GC1, GC2, KG1 to KG4    | 85 % to 95 %         |
| Early rival  | PT3, PT4, PT5, GC3, GC4           | 70 % to 85 %         |
| Middle rival | PT6, PT7, GC5, GC6, KG5, KG6, KG7 | 55 % to 70 %         |
| Late rival   | GC7, KG8, KG9                     | 45 % to 60 %         |
| Boss         | PT8, GC8, KG10                    | 35 % to 50 %         |
| Finale       | MQ1, MQ2, MQ3                     | 60 % to 80 %         |
| Encore       | PT9, GC9, KG11                    | 10 % to 25 %         |

The curve dips at the start of every district because each district is a new game. The finale is deliberately
easier than the bosses: it is a victory lap with Bit, not a wall before the ending.

### How the tutorials teach each game

**Rock Paper Scissors** (PT1, PT2):

1. PT1 shows the three choices as big buttons and a rule card: rock beats scissors, scissors beat paper, paper beats
   rock. Bit plays at random, so every choice is fair.
2. The first draw triggers Bit's line that a draw is played again and does not count.
3. The clean star asks you to try all three choices, so every player sees every outcome.
4. PT2 adds the platform: the match bar dots, the result card and Rematch. Bit accepts at once, and the series score
   shows both games.

**Tic Tac Toe** (GC1, GC2, then GC3 and GC4):

1. GC1: you are X. The eight winning lines glow once. Bit (`practice`) never blocks, so the only task is finding a
   line. A highlight on the first two in a row asks "Where's the third?"
2. GC2: a start board where Bit threatens to win. You learn to look at the rival's lines first. The only good move is
   the block, and it creates two threats at once, so the next move wins.
3. GC3 (Dot) rewards taking a win at once. GC4 (Blocky) blocks every single threat, so the only way through is a fork,
   which Bit names when it happens.

**Chess** (KG1 to KG4, then KG5 for values and castling):

1. KG1: only kings and pawns. Moving forward, the double first step, diagonal captures and promotion. When en passant
   becomes possible for the first time, Bit explains it in one line.
2. KG2: rook and bishop. Straight lines and diagonals. The bishop can reach only one of the three pawns, which shows
   that a bishop stays on its colour.
3. KG3: knight and queen. The L jump over pieces and the queen as rook plus bishop. Losing a piece fails the level,
   which teaches that pieces can be taken by the king.
4. KG4: check and checkmate with a rook, a queen and a knight in turn. A wrong try explains which square the king
   could still escape to.
5. KG5: a whole board, but only goals of 10 points of captures. Piece values are shown on a card. The first time
   castling is legal, Bit explains it. Full checkmate games follow from KG6.

---

## 5. Dialogue

### Tone guide

1. **Warm and short.** At most two lines per beat, each line at most about 60 characters. Read aloud, a beat takes
   under five seconds.
2. **Plain words** a seven year old can read. No slang that dates, no sarcasm aimed at the player, no in jokes.
3. **Kind losses.** A loss line always says something good about the game, then gives one concrete idea for next time.
   Never "you lose", "too bad", "easy" or "try harder".
4. **Gentle words for games.** Pieces are captured or taken, never killed. Nobody is crushed, destroyed or beaten up.
5. **The player is "you".** No name, no gender, no age. Characters may say "friend".
6. **Every character sounds like themselves.** Rocky is proud of rock, Copycat purrs, Crumple takes notes, The
   Architect speaks in plans. One catchphrase per level at most, so it stays charming.
7. **Characters never ask for anything personal** and never push sign up. Only Bit mentions saving progress, once per
   district, as an offer.
8. **Rules are taught by Bit**, rivals only hint at their own habits, so players learn who to listen to.
9. **Punctuation follows the comment style** (docs/ENGINEERING.md): no semicolons, no dashes as punctuation. An ellipsis
   is allowed for a thinking pause, at most one per beat.

### How to read the scripts

1. Beats: **Intro** plays before the game. Reaction beats play during the game when the named moment happens.
   **Win** and **Loss** play in the result card. **Outro** plays once, on the first clear only.
2. Moment ids come from the game modules' `moments` (ADR-020) plus the story moments listed in section 6. A reaction
   plays at most once per game, with at least 4 seconds between bubbles. `round-won` and `round-lost` may play up to
   twice per game.
3. "Speaker (mood)" names the character and the expression to show. Two lines in one beat are separated by a line
   break in the cell. A level without a beat for a moment simply stays quiet.
4. Script files live in `apps/web/src/story/scripts/<district>.js` keyed by level id and beat, so a writer can change
   a line without touching code. A unit test checks every line against the length limit and the punctuation rules.

### Scenes between levels

| Scene             | Speaker (mood)  | Line                                                                                  |
| ----------------- | --------------- | ------------------------------------------------------------------------------------- |
| Prologue 1        | Bit (surprised) | Oh! A visitor! Sorry, it's a bit dark in here.                                        |
| Prologue 2        | Bit (sad)       | The lights went out when people stopped playing together.                             |
| Prologue 3        | Bit (thinking)  | Every fair game makes a spark.<br>Enough sparks, and the arcade wakes up again.       |
| Prologue 4        | Bit (happy)     | Will you help me? Let's start in Paper Town!                                          |
| Grid City arrival | Bit (happy)     | Welcome to Grid City, where everything comes in threes.                               |
| Grid City arrival | Bit (thinking)  | Rows, columns and diagonals. Line up three to win.                                    |
| Kingdom arrival   | Bit (happy)     | The Kingdom! Chess is the oldest game in the arcade.                                  |
| Kingdom arrival   | Bit (thinking)  | It looks tricky, so we'll learn one piece at a time.                                  |
| Marquee arrival   | Bit (thinking)  | This is the Marquee, the arcade's big sign.<br>It needs all three sparks.             |
| Marquee arrival   | Bit (happy)     | One last thing: play me in each game. For old times' sake!                            |
| Save your stars   | Bit (happy)     | You've earned a spark! Want to keep your stars on any device?<br>Make a free account. |

The "Save your stars" scene shows only to guests, only after a boss, and has two buttons of equal weight: "Make an
account" and "Not now". "Not now" never shows the scene again for that district.

### Ending

| Beat | Speaker (mood)         | Line                                                           |
| ---- | ---------------------- | -------------------------------------------------------------- |
| 1    | Bit (surprised)        | Three sparks! Hold on tight...                                 |
| 2    | (no speaker)           | The Marquee flickers, then lights up letter by letter.         |
| 3    | Madame Origami (happy) | The cranes are flying again.                                   |
| 4    | The Architect (happy)  | Grid City is glowing. Exactly as planned.                      |
| 5    | King Oldwick (happy)   | The Kingdom hasn't shone like this in years.                   |
| 6    | Rocky (happy)          | Rock solid!                                                    |
| 7    | Copycat (happy)        | Rock solid! Meow.                                              |
| 8    | Bit (cheer)            | The arcade is open! And it shines brightest with friends.      |
| 9    | Bit (happy)            | Invite someone, or find a match. I'll be right here, cheering. |

Beat 2 is a caption read by screen readers, shown as text in every mode. The ending closes on three buttons: **Invite
a friend**, **Play now** (quick match) and **Back to the map**, plus a **Share** button for the "Arcade relit" card.

### Paper Town scripts

**PT1 First throw** (Bit)

| Beat       | Speaker (mood)  | Line                                                                                  |
| ---------- | --------------- | ------------------------------------------------------------------------------------- |
| Intro      | Bit (happy)     | This is Paper Town! Everything here is folded, even the rules.                        |
| Intro      | Bit (thinking)  | Rock beats scissors. Scissors beat paper. Paper beats rock.<br>Win two rounds to win. |
| round-won  | Bit (surprised) | Nice throw!                                                                           |
| round-lost | Bit (happy)     | My point this time. Try another one!                                                  |
| round-draw | Bit (thinking)  | Same choice! A draw is played again.                                                  |
| Win        | Bit (happy)     | You won! See that little light? That's your first spark.                              |
| Loss       | Bit (happy)     | So close! Rounds are quick, let's go again.                                           |

**PT2 Again!** (Bit)

| Beat        | Speaker (mood)  | Line                                                                   |
| ----------- | --------------- | ---------------------------------------------------------------------- |
| Intro       | Bit (happy)     | Good games end with a rematch.<br>Finish this one, then press Rematch. |
| round-won   | Bit (surprised) | Look at the bar at the top. Your dot lit up!                           |
| series-next | Bit (happy)     | Rematch! The series score remembers both games.                        |
| Win         | Bit (happy)     | Two games, one friend. That's how the arcade glows.                    |
| Loss        | Bit (happy)     | Every rematch is a fresh start. One more?                              |

**PT3 Rock solid** (Rocky)

| Beat       | Speaker (mood)    | Line                                                    |
| ---------- | ----------------- | ------------------------------------------------------- |
| Intro      | Rocky (happy)     | Name's Rocky. Rock solid, rock steady, rock everything! |
| Intro      | Bit (thinking)    | Hmm. I wonder what Rocky likes to throw.                |
| round-won  | Rocky (surprised) | Paper? How do you keep guessing?                        |
| round-lost | Rocky (happy)     | Ha! Rock solid!                                         |
| round-draw | Rocky (thinking)  | Rock and rock. Great choice, if I say so myself.        |
| hint-used  | Bit (thinking)    | Rocky really, really likes rock. What wraps a rock?     |
| Win        | Rocky (happy)     | Wrapped up again! You read me like a book.              |
| Win        | Bit (happy)       | When someone has a favourite, play what beats it.       |
| Loss       | Rocky (happy)     | Good game! Watch my hands next time. They love rock.    |

**PT4 Copy that** (Copycat)

| Beat       | Speaker (mood)      | Line                                                       |
| ---------- | ------------------- | ---------------------------------------------------------- |
| Intro      | Copycat (happy)     | Meow you see it, meow you don't!                           |
| Intro      | Copycat (thinking)  | Whatever you threw last, I like it too.                    |
| round-won  | Copycat (surprised) | Hey! You didn't do what I did what you did!                |
| round-lost | Copycat (happy)     | Copied and pasted!                                         |
| round-draw | Copycat (happy)     | Twins! Purr-fect.                                          |
| hint-used  | Bit (thinking)      | Copycat throws your last move. So beat your own last move! |
| Win        | Copycat (sad)       | You out-copied the copycat.                                |
| Win        | Bit (happy)         | Your own habits can be someone else's plan. Nice thinking! |
| Loss       | Copycat (happy)     | Fun! Remember what you threw last. I always do.            |

**PT5 Round and round** (Whirly)

| Beat           | Speaker (mood)     | Line                                                               |
| -------------- | ------------------ | ------------------------------------------------------------------ |
| Intro          | Whirly (happy)     | Round and round! Rock, paper, scissors, repeat!                    |
| Intro          | Bit (sad)          | Bad news: the shop is out of scissors. You can't throw them today. |
| choice-blocked | Bit (thinking)     | No scissors today! Try rock or paper.                              |
| round-won      | Whirly (surprised) | Whoa, you're spinning with me!                                     |
| round-lost     | Whirly (happy)     | Wheee! Around I go!                                                |
| round-draw     | Whirly (thinking)  | Same spot on the wheel!                                            |
| hint-used      | Bit (thinking)     | Whirly goes rock, then paper, then scissors. What comes next?      |
| Win            | Whirly (sad)       | My wheel got figured out!                                          |
| Win            | Bit (happy)        | You planned around a missing choice. That's real strategy.         |
| Loss           | Whirly (happy)     | Spin again? Watch my order. It hardly ever changes.                |

**PT6 Lucky lights** (Lulu Lantern)

| Beat       | Speaker (mood)   | Line                                                                              |
| ---------- | ---------------- | --------------------------------------------------------------------------------- |
| Intro      | Lulu (happy)     | When a throw wins, I keep it. Lucky moves never change!                           |
| Intro      | Bit (thinking)   | Only 7 rounds to win 3. Make every round count.                                   |
| round-won  | Lulu (surprised) | Oh! Time for new luck, I think.                                                   |
| round-lost | Lulu (happy)     | Lucky! I'm keeping that one.                                                      |
| round-draw | Lulu (thinking)  | A tie... my lantern flickers.                                                     |
| rounds-low | Bit (surprised)  | Two rounds left! Think about what she'll do next.                                 |
| hint-used  | Bit (thinking)   | After a win, Lulu repeats.<br>After a loss, she throws what beats your last move. |
| Win        | Lulu (happy)     | You made your own luck. That's the best kind!                                     |
| Win        | Bit (happy)      | Thinking two steps ahead beats luck every time.                                   |
| Loss       | Lulu (happy)     | The lantern smiled on me today. It might smile on you next!                       |

**PT7 Taking notes** (Professor Crumple)

| Beat       | Speaker (mood)      | Line                                                            |
| ---------- | ------------------- | --------------------------------------------------------------- |
| Intro      | Crumple (thinking)  | Fascinating! I take notes on every throw you make.              |
| Intro      | Crumple (happy)     | My notebook is open. You may peek.                              |
| habit      | Bit (thinking)      | That's twice in a row. The Professor is writing that down!      |
| round-won  | Crumple (surprised) | That was not in my notes!                                       |
| round-lost | Crumple (happy)     | Exactly as my notes predicted.                                  |
| round-draw | Crumple (thinking)  | Hmm. Noted. Noted twice.                                        |
| hint-used  | Bit (thinking)      | Check his notebook. He expects your favourite, so surprise him. |
| Win        | Crumple (happy)     | Unpredictable! I shall need a bigger notebook.                  |
| Win        | Bit (happy)         | Mixing it up keeps pattern readers guessing.                    |
| Loss       | Crumple (happy)     | A fine experiment! Try the choice you use the least.            |

**PT8 The paper crane** (Madame Origami, boss)

| Beat        | Speaker (mood)      | Line                                                                          |
| ----------- | ------------------- | ----------------------------------------------------------------------------- |
| Intro       | Bit (surprised)     | That's Madame Origami, the champion of Paper Town!                            |
| Intro       | Origami (thinking)  | Every fold tells a story. Let me read yours.<br>Win three rounds before I do. |
| round-won   | Origami (surprised) | A new fold. Lovely.                                                           |
| round-lost  | Origami (happy)     | I saw that one coming, my dear.                                               |
| round-draw  | Origami (thinking)  | We think alike, you and I.                                                    |
| match-point | Origami (thinking)  | One more, and the cranes will fly.                                            |
| hint-used   | Bit (thinking)      | She reads habits. Don't repeat yourself, and watch the fold board.            |
| Win         | Origami (happy)     | Show me something new, I said. And you did.                                   |
| Win         | Origami (happy)     | Take this spark. Paper Town glows again!                                      |
| Loss        | Origami (happy)     | A graceful game. Come back, and fold differently.                             |
| Outro       | Bit (happy)         | Paper Town is lit! Grid City is next. It needs you.                           |

**PT9 Origami unfolded** (Madame Origami, encore)

| Beat       | Speaker (mood)      | Line                                                                                    |
| ---------- | ------------------- | --------------------------------------------------------------------------------------- |
| Intro      | Origami (thinking)  | You relit the arcade. Now let me fold at full strength.<br>Win four rounds before I do. |
| round-won  | Origami (surprised) | Still surprising me!                                                                    |
| round-lost | Origami (happy)     | Every fold, remembered.                                                                 |
| round-draw | Origami (thinking)  | Mirror folds.                                                                           |
| Win        | Origami (happy)     | Truly unforgettable. This frame is yours.                                               |
| Loss       | Origami (happy)     | Even champions fold sometimes. Again?                                                   |

### Grid City scripts

**GC1 Three in a row** (Bit)

| Beat         | Speaker (mood)  | Line                                               |
| ------------ | --------------- | -------------------------------------------------- |
| Intro        | Bit (happy)     | You are X. Put three X marks in a row.             |
| Intro        | Bit (thinking)  | Across, down, or corner to corner. They all count! |
| you-threaten | Bit (surprised) | Two in a row! Where's the third?                   |
| Win          | Bit (happy)     | Three in a row! The grid lights up.                |
| Loss         | Bit (happy)     | No line this time. Try the middle or a corner!     |

**GC2 Block!** (Bit)

| Beat        | Speaker (mood)  | Line                                             |
| ----------- | --------------- | ------------------------------------------------ |
| Intro       | Bit (thinking)  | Uh oh. I have two O marks in a row at the top.   |
| Intro       | Bit (happy)     | Stop me first, then look again.                  |
| you-blocked | Bit (surprised) | Blocked! And look, now you have two lines ready. |
| fork        | Bit (surprised) | Two threats at once! I can only stop one.        |
| Win         | Bit (happy)     | Block first, then win. Remember that one!        |
| Loss        | Bit (happy)     | Always check: can they win next move? Try again. |

**GC3 Boop!** (Dot)

| Beat          | Speaker (mood)  | Line                                                     |
| ------------- | --------------- | -------------------------------------------------------- |
| Intro         | Dot (happy)     | Boop! I'm Dot! I love bouncing around the grid!          |
| Intro         | Bit (thinking)  | Dot is new here. Can you take your chances?              |
| they-threaten | Dot (surprised) | Ooh, I have two! Do I? I do!                             |
| you-threaten  | Dot (thinking)  | Are you about to win? Boop?                              |
| missed-win    | Bit (thinking)  | There was a winning square there. Look for it next time! |
| draw          | Dot (happy)     | Nobody won! Let's bounce again.                          |
| Win           | Dot (surprised) | Wait, was that a win? For you? Nice one!                 |
| Win           | Bit (happy)     | When you can win, win first.                             |
| Loss          | Dot (happy)     | I won? I won! Boop boop! Want to play again?             |

**GC4 Not on my watch** (Blocky)

| Beat         | Speaker (mood)     | Line                                               |
| ------------ | ------------------ | -------------------------------------------------- |
| Intro        | Blocky (thinking)  | I'm Blocky. One line? I block it. Every time.      |
| Intro        | Bit (thinking)     | One threat is never enough against Blocky.         |
| they-blocked | Blocky (happy)     | Blocked! Not on my watch.                          |
| fork         | Blocky (surprised) | Two lines? I only have one pair of hands!          |
| draw         | Blocky (happy)     | Nobody gets through. Draws replay, so try again.   |
| hint-used    | Bit (thinking)     | Make two threats with one move. Corners help.      |
| Win          | Blocky (sad)       | Two at once. I should grow more hands.             |
| Win          | Bit (happy)        | That's called a fork: two threats nobody can stop. |
| Loss         | Blocky (happy)     | Good try. Build two lines, not one.                |

**GC5 Corner collector** (Cornelius)

| Beat          | Speaker (mood)        | Line                                                        |
| ------------- | --------------------- | ----------------------------------------------------------- |
| Intro         | Cornelius (happy)     | Good day! I collect corners, and I go first today.          |
| Intro         | Bit (thinking)        | When someone takes a corner, the middle is a strong answer. |
| centre-taken  | Cornelius (surprised) | The centre? How unexpected.                                 |
| they-threaten | Cornelius (thinking)  | Two corners. A lovely pair.                                 |
| you-blocked   | Cornelius (sad)       | Oh dear, you've blocked my avenue.                          |
| Win           | Cornelius (happy)     | Outplayed from the second seat. Bravo!                      |
| Win           | Bit (happy)           | Going second is harder. You handled it!                     |
| Loss          | Cornelius (happy)     | Corners, please! Next time, take the centre early.          |

**GC6 Mirror, mirror** (Mira)

| Beat          | Speaker (mood)   | Line                                                          |
| ------------- | ---------------- | ------------------------------------------------------------- |
| Intro         | Mira (happy)     | Left is right, right is left. I move opposite you.            |
| Intro         | Bit (sad)        | The centre square is closed for repairs today.                |
| cell-blocked  | Bit (thinking)   | That square is under repair. Pick another!                    |
| they-threaten | Mira (thinking)  | Perfectly balanced, as always.                                |
| fork          | Mira (surprised) | Two lines? My mirror didn't show that!                        |
| hint-used     | Bit (thinking)   | Try two edges next to the same corner, then take that corner. |
| Win           | Mira (happy)     | You found the crack in my mirror.                             |
| Win           | Bit (happy)      | Edges first, then a corner fork. Clever!                      |
| Loss          | Mira (happy)     | Reflect on it, and try again!                                 |

**GC7 Speed lights** (Nova)

| Beat          | Speaker (mood)   | Line                                              |
| ------------- | ---------------- | ------------------------------------------------- |
| Intro         | Nova (happy)     | Shine time! Five seconds a move. Keep up!         |
| Intro         | Bit (thinking)   | Nova wins and blocks fast. Win two games to pass. |
| time-low      | Bit (surprised)  | Quick, pick a square!                             |
| time-out      | Bit (thinking)   | Time ran out, so a square was picked for you.     |
| they-threaten | Nova (happy)     | Fast and bright, two in a row!                    |
| fork          | Nova (surprised) | Whoa, a double! I didn't see it in time.          |
| Win           | Nova (happy)     | You out-shined me. Respect!                       |
| Win           | Bit (happy)      | Quick thinking with a plan. You're ready.         |
| Loss          | Nova (happy)     | Fun race! Take a breath, then go again.           |

**GC8 The blueprint** (The Architect, boss)

| Beat          | Speaker (mood)       | Line                                                                 |
| ------------- | -------------------- | -------------------------------------------------------------------- |
| Intro         | Bit (surprised)      | The Architect has never lost a game. Not once.                       |
| Intro         | Architect (thinking) | Play me twice, once as X and once as O.<br>Do not lose. That is all. |
| they-threaten | Architect (thinking) | A line, drawn true.                                                  |
| you-blocked   | Architect (happy)    | Correct. You read the blueprint.                                     |
| draw          | Architect (happy)    | A draw against me is a masterpiece.                                  |
| hint-used     | Bit (thinking)       | Check his lines before your own. A draw is a win here!               |
| Win           | Architect (happy)    | Perfect play meets perfect play. Well built.                         |
| Win           | Architect (happy)    | This spark is yours. Grid City shines!                               |
| Loss          | Architect (thinking) | One block missed. Study the corners and return.                      |
| Outro         | Bit (happy)          | Grid City glows! Only the Kingdom is still dark.                     |

**GC9 Master plans** (The Architect, encore)

| Beat      | Speaker (mood)        | Line                                                                                  |
| --------- | --------------------- | ------------------------------------------------------------------------------------- |
| Intro     | Architect (thinking)  | Three blueprints. In each, one move wins by force.<br>Find it, and I cannot stop you. |
| fork      | Architect (surprised) | Elegant. Two lines, one move.                                                         |
| stage-won | Architect (happy)     | Next blueprint.                                                                       |
| Win       | Architect (happy)     | You read every plan. The Circuit frame is yours.                                      |
| Loss      | Architect (thinking)  | That move left me a way out. Look for two lines at once.                              |

### The Kingdom scripts

**KG1 Pawn race** (Bit)

| Beat             | Speaker (mood)  | Line                                                                |
| ---------------- | --------------- | ------------------------------------------------------------------- |
| Intro            | Bit (happy)     | Pawns march forward one square, or two on their first move.         |
| Intro            | Bit (thinking)  | They capture one square diagonally. Reach the far side first!       |
| capture-by-you   | Bit (surprised) | A diagonal capture! Exactly right.                                  |
| capture-by-them  | Bit (happy)     | I took one of yours. Watch the diagonals!                           |
| en-passant-ready | Bit (thinking)  | Secret rule: a pawn that jumps two can be taken as if it moved one. |
| promoted-by-you  | Bit (surprised) | Promotion! A pawn that reaches the end becomes a queen.             |
| Win              | Bit (happy)     | You promoted first! Pawns can become heroes.                        |
| Loss             | Bit (happy)     | My pawn got there first. Try blocking mine with yours!              |

**KG2 Straight and slanted** (Bit)

| Beat           | Speaker (mood)  | Line                                                                     |
| -------------- | --------------- | ------------------------------------------------------------------------ |
| Intro          | Bit (happy)     | The rook slides straight. The bishop slides on diagonals.                |
| Intro          | Bit (thinking)  | Capture my three pawns. Careful, my king can take things too!            |
| capture-by-you | Bit (surprised) | Got one!                                                                 |
| bishop-colour  | Bit (thinking)  | A bishop stays on its own colour forever. Your rook must fetch the rest. |
| piece-attacked | Bit (thinking)  | My king is right next to your piece. Is it safe?                         |
| Win            | Bit (happy)     | Straight and slanted, both mastered!                                     |
| Loss           | Bit (happy)     | My king nabbed one. Keep your pieces away from him.                      |

**KG3 Hops and the queen** (Bit)

| Beat           | Speaker (mood)  | Line                                                            |
| -------------- | --------------- | --------------------------------------------------------------- |
| Intro          | Bit (happy)     | The knight jumps in an L shape, right over anything.            |
| Intro          | Bit (thinking)  | The queen moves like a rook and a bishop. Catch all four pawns! |
| capture-by-you | Bit (surprised) | Hop and grab!                                                   |
| piece-attacked | Bit (thinking)  | Your queen is precious. Is she safe there?                      |
| Win            | Bit (happy)     | The knight hops, the queen rules. You've met them all!          |
| Loss           | Bit (happy)     | Oops, that piece got caught. One more go?                       |

**KG4 Check and mate** (Bit)

| Beat        | Speaker (mood)  | Line                                                                       |
| ----------- | --------------- | -------------------------------------------------------------------------- |
| Intro       | Bit (happy)     | Attacking the king is called check. A king in check must escape.           |
| Intro       | Bit (thinking)  | If the king can't escape at all, that's checkmate.<br>Find it in one move! |
| stage-retry | Bit (thinking)  | Not quite. Can the king still run somewhere?                               |
| stage-won   | Bit (surprised) | Checkmate! On to the next one.                                             |
| Win         | Bit (happy)     | Three checkmates! Now you know how chess is won.                           |
| Loss        | Bit (happy)     | Look at every square around the king, then try again.                      |

**KG5 Onward!** (Sir Pawnsley)

| Beat            | Speaker (mood)       | Line                                                                     |
| --------------- | -------------------- | ------------------------------------------------------------------------ |
| Intro           | Pawnsley (happy)     | Onward, one square at a time! I'll even leave my queen at home.          |
| Intro           | Bit (thinking)       | Pawn 1, knight 3, bishop 3, rook 5, queen 9.<br>Win 10 points of pieces! |
| capture-by-you  | Pawnsley (surprised) | Oh no, my brave piece!                                                   |
| capture-by-them | Pawnsley (happy)     | Ha! Onward!                                                              |
| castle-ready    | Bit (thinking)       | Tip: castling tucks your king away safely and wakes up a rook.           |
| check-by-them   | Pawnsley (happy)     | Check! I've always wanted to say that.                                   |
| Win             | Pawnsley (happy)     | You outscored me fair and square. Well, fair and squares!                |
| Win             | Bit (happy)          | Count the points before you capture. Free pieces are the best pieces.    |
| Loss            | Pawnsley (happy)     | A brave effort! Look for pieces nobody is guarding.                      |

**KG6 Diagonally yours** (Duchess Diagonal)

| Beat            | Speaker (mood)      | Line                                                  |
| --------------- | ------------------- | ----------------------------------------------------- |
| Intro           | Duchess (happy)     | Why go straight when you can glide? Diagonally yours. |
| Intro           | Bit (thinking)      | A full game this time. Checkmate the Duchess to pass. |
| capture-by-them | Duchess (happy)     | Swoosh! Never underestimate a diagonal.               |
| check-by-you    | Duchess (surprised) | How bold!                                             |
| castled-by-you  | Duchess (happy)     | Castled already? How very proper.                     |
| Win             | Duchess (happy)     | Checkmate, darling. Splendidly done.                  |
| Win             | Bit (happy)         | Bring all your pieces out, then go for the king.      |
| Loss            | Duchess (happy)     | Mind the long diagonals, dear. They reach far.        |

**KG7 Hop, hop, fork** (Hopscotch)

| Beat            | Speaker (mood)        | Line                                                    |
| --------------- | --------------------- | ------------------------------------------------------- |
| Intro           | Hopscotch (happy)     | Hop, hop, fork! Only knights and pawns today.           |
| Intro           | Bit (thinking)        | Promote a pawn, or checkmate. And watch those jumps!    |
| fork-by-them    | Hopscotch (happy)     | Two things at once! Which one will you save?            |
| fork-by-you     | Hopscotch (surprised) | You forked me? That's my trick!                         |
| promoted-by-you | Hopscotch (surprised) | A queen! Over the top!                                  |
| Win             | Hopscotch (happy)     | Out-hopped! You're a natural.                           |
| Win             | Bit (happy)           | A knight attacking two pieces at once is called a fork. |
| Loss            | Hopscotch (happy)     | Hop back in! Keep your pieces out of my L shapes.       |

**KG8 The ladder** (Castellan Rook)

| Beat           | Speaker (mood)        | Line                                                                                |
| -------------- | --------------------- | ----------------------------------------------------------------------------------- |
| Intro          | Castellan (thinking)  | I'll lend you my two rooks. Corner my king, if you can.                             |
| Intro          | Bit (thinking)        | Rooks take turns, like climbing a ladder.<br>And never leave the king with no move! |
| check-by-you   | Castellan (surprised) | Pushed back a row!                                                                  |
| piece-attacked | Castellan (happy)     | Your rook is close to my king. Too close!                                           |
| stalemate      | Bit (thinking)        | Stalemate! The king couldn't move but wasn't in check, so it's a draw.              |
| Win            | Castellan (happy)     | Checkmate on the edge. A perfect ladder.                                            |
| Win            | Bit (happy)           | Two rooks can always win. You just proved it.                                       |
| Loss           | Castellan (happy)     | My king slipped away this time. Climb the ladder again!                             |

**KG9 Quill's puzzles** (Queen Quill)

| Beat        | Speaker (mood)    | Line                                                        |
| ----------- | ----------------- | ----------------------------------------------------------- |
| Intro       | Quill (happy)     | A puzzle a day! Each one is checkmate in two moves.         |
| Intro       | Quill (thinking)  | Two moves. No more, no less.                                |
| stage-retry | Quill (thinking)  | My king found a way out. Try another first move.            |
| stage-won   | Quill (surprised) | Solved! Next page.                                          |
| Win         | Quill (happy)     | Three puzzles solved. I'll write you into my book!          |
| Win         | Bit (happy)       | Checks are strong. Sometimes a quiet move is even stronger. |
| Loss        | Quill (happy)     | Every great puzzler starts again. Take your time.           |

**KG10 The old king** (King Oldwick, boss)

| Beat            | Speaker (mood)      | Line                                                                                  |
| --------------- | ------------------- | ------------------------------------------------------------------------------------- |
| Intro           | Bit (surprised)     | King Oldwick! He hasn't played anyone in years.                                       |
| Intro           | Oldwick (sad)       | Nobody visits the Kingdom any more. Hmph. A game, then.<br>My queen is resting today. |
| capture-by-them | Oldwick (happy)     | Hmph. Still got it.                                                                   |
| capture-by-you  | Oldwick (surprised) | Oh ho! Sharp eyes.                                                                    |
| check-by-you    | Oldwick (thinking)  | Check, is it? Let me think.                                                           |
| castled-by-you  | Oldwick (happy)     | Castling. Good habits, friend.                                                        |
| Win             | Oldwick (happy)     | Checkmate. I'd forgotten how good a game feels.                                       |
| Win             | Oldwick (happy)     | Take this spark. Let the Kingdom shine!                                               |
| Loss            | Oldwick (happy)     | A fine fight. Come back soon. Please do.                                              |
| Outro           | Bit (happy)         | Three sparks! Let's bring them to the Marquee.                                        |

**KG11 Full strength** (King Oldwick, encore)

| Beat           | Speaker (mood)      | Line                                                                               |
| -------------- | ------------------- | ---------------------------------------------------------------------------------- |
| Intro          | Oldwick (thinking)  | My queen is back, and so is my best play.<br>Don't lose to me, and that's special. |
| capture-by-you | Oldwick (surprised) | Well spotted!                                                                      |
| check-by-them  | Oldwick (happy)     | Check. Mind your king, friend.                                                     |
| Win            | Oldwick (happy)     | Splendid! Wear this crown, champion.                                               |
| draw           | Oldwick (happy)     | A draw with the old king. Not bad at all.                                          |
| Loss           | Oldwick (happy)     | I play like this every day. Come practise with me.                                 |

### The Marquee scripts

**MQ1 Paper spark** (Bit)

| Beat       | Speaker (mood)  | Line                                                 |
| ---------- | --------------- | ---------------------------------------------------- |
| Intro      | Bit (happy)     | Paper spark first! I've been learning too, you know. |
| round-won  | Bit (surprised) | You remembered everything!                           |
| round-lost | Bit (happy)     | Ha, I read that one!                                 |
| round-draw | Bit (thinking)  | Great minds!                                         |
| Win        | Bit (happy)     | The paper spark is in! One light on.                 |
| Loss       | Bit (happy)     | Again! I'm having too much fun.                      |

**MQ2 Grid spark** (Bit)

| Beat          | Speaker (mood)  | Line                                    |
| ------------- | --------------- | --------------------------------------- |
| Intro         | Bit (thinking)  | Grid spark next. I'll start, you block! |
| they-threaten | Bit (happy)     | Two in a row, beep!                     |
| fork          | Bit (surprised) | A fork! You've been practising.         |
| Win           | Bit (happy)     | Grid spark in! Two lights on.           |
| Loss          | Bit (happy)     | Watch my corners. Again!                |

**MQ3 The quiet move** (Bit)

| Beat        | Speaker (mood)  | Line                                                   |
| ----------- | --------------- | ------------------------------------------------------ |
| Intro       | Bit (thinking)  | Last spark. Checkmate in two, but first a quiet move.  |
| Intro       | Bit (happy)     | Sometimes the best move doesn't attack at all.         |
| stage-retry | Bit (thinking)  | The king escaped. What if you didn't check right away? |
| Win         | Bit (surprised) | That's it! The last spark!                             |
| Loss        | Bit (happy)     | Take your time. Look where the king can go.            |

MQ3's win goes straight into the ending scene.

---

## 6. Systems

### Screens and URLs (ADR-011)

| Screen       | URL                             | Title                                | What it shows                                          |
| ------------ | ------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| World map    | `/quest`                        | ClassiCade Quest                     | The four districts, total stars, Continue              |
| District map | `/quest/:district`              | Paper Town · ClassiCade Quest        | The level path of one district                         |
| Level        | `/quest/:district/:number`      | PT3 Rock solid · ClassiCade Quest    | Rival, goal, star rules, best stars, Play, Watch scene |
| Match        | `/quest/:district/:number/play` | Playing Rocky · ClassiCade Quest     | The game shell with the dialogue strip                 |
| Ending       | `/quest/ending`                 | The arcade is lit · ClassiCade Quest | The ending scene, replayable once seen                 |

District slugs are permanent: `paper-town`, `grid-city`, `the-kingdom`, `the-marquee`. Paths are built only in
`apps/web/src/app/paths.js`. A locked level's URL shows the district map with that node focused and a short note
("Clear Whirly first"), using replace so Back never lands on a redirect.

Back and Forward:

1. World map, district map, level page and match are four history entries. Back from the match returns to the level
   page. The room stays alive for the reconnect grace of CC-036, so Forward goes straight back into the game.
2. Leaving a Quest match is never a forfeit with a penalty. If the room closes, the attempt simply does not count.
3. Next level from the result card pushes the next level page, so Back returns to the previous level's page, not into
   a finished match.
4. Reload on the match URL rejoins the player's open room for that level, or shows the level page if there is none.

### Level map UI

World map, desktop (1280 by 720):

```
┌ Header ──────────────────────────────────────────── Level 4 [▓▓▓▓░░] ┐
│ ClassiCade Quest                                   ★ 14 of 96         │
│                                                                       │
│     ╭────────────╮      ╭────────────╮      ╭──────────────╮          │
│     │ Paper Town │══════│ Grid City  │══════│ The Kingdom  │          │
│     │  lit ★ 18  │      │  dim ★ 4   │      │   locked     │          │
│     ╰────────────╯      ╰────────────╯      ╰──────────────╯          │
│              ╲                │                  ╱                    │
│                     ╭──────────────────╮                              │
│                     │   The Marquee    │  dark until 3 sparks         │
│                     ╰──────────────────╯                              │
│                                                                       │
│  [Bit] Next up: Mira in Grid City!                  [ Continue ▸ ]    │
└───────────────────────────────────────────────────────────────────────┘
```

District map, desktop. The path winds left to right, the boss sits at the end, the encore node appears after the
ending:

```
┌ Header ───────────────────────────────────────────────────────────────┐
│ ‹ Quest   Paper Town                          ★ 18 of 27              │
│                                                                       │
│  (1)★★★ ── (2)★★☆ ── (3)★★★ ── (4)★☆☆ ── (5)☆☆☆ ── (6)lock             │
│   Bit       Bit      Rocky    Copycat   Whirly    Lulu                │
│                                              ╲                        │
│                         (9)lock ── (8)lock ── (7)lock                    │
│                         encore     Origami    Crumple                 │
│                                                                       │
│  ┌ Selected: 5 Round and round ───────────────────────────────────┐   │
│  │ [Whirly]  Win a best-of-5. No scissors today!                  │   │
│  │ ★ win   ★ within 6 rounds   ★ lose no round       [ Play ▸ ]   │   │
│  └────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘
```

District map, mobile (390 by 844). The path runs top to bottom, the selected level opens as a bottom sheet:

```
┌ ‹ Paper Town   ★ 18/27 ┐
│                        │
│   (1) ★★★  Bit         │
│    │                   │
│   (2) ★★☆  Bit         │
│    │                   │
│   (3) ★★★  Rocky       │
│    │                   │
│   (4) ★☆☆  Copycat     │
│    │                   │
│   (5) ☆☆☆  Whirly  ◀   │
│    │                   │
│   (6) lock  Lulu        │
│   ...                  │
├────────────────────────┤
│ [Whirly] Round and     │
│ round. No scissors!    │
│ ★ win ★ ≤6 ★ no loss   │
│ [      Play ▸      ]   │
└────────────────────────┘
```

Level page and the match, desktop. The dialogue strip sits between the match bar and the board and never covers the
board or the action bar:

```
┌ Header ───────────────────────────────────────────────────────────────┐
├ Match bar: You 1 ●○ 0 Whirly · Round 3 · Goal: 3 wins · ★★ 3/6 rounds ┤
├ Dialogue strip: [Whirly happy] "Wheee! Around I go!"     [Hide chatter]┤
├──────────────────────────────────────────────┬────────────────────────┤
│                                              │ Whirly  thinking...    │
│        Board (from the game module)          │ Your throws: R P P     │
│   [Result card with stars at the end]        │                        │
├ Action bar: [Hint]  [Leave]   or at the end [Next level ▸] [Try again] [Map] ┤
```

Mobile match:

```
┌ compact header ────────┐
├ 1 ●○ 0 · R3 · ★★ 3/6   ┤
├ [Whirly] Wheee!        ┤  (one line, tap to read in full)
│                        │
│        Board           │
│                        │
├ [Hint] [Leave]         ┤  sticky action bar
at the end: bottom sheet with ★ ★ ★, the rival's line, [Next level] [Try again]
```

Map rules:

1. Every node is a real `<a>` link with an accessible name such as "Level 5, Round and round, against Whirly, 0 of 3
   stars, open". Locked nodes are links too, they explain what unlocks them.
2. Arrow keys move along the path, Enter opens the level, Home and End jump to the first and last node.
3. Stars are drawn shapes and also text ("2 of 3 stars"), never colour alone.
4. Touch targets are at least 44 px. On mobile the path auto scrolls so the next open level is in view, without
   animation when reduced motion is on.
5. Continue on the world map goes to the first open level without stars, or the first level missing a star, in that
   order.

### Progress storage (server side, per player)

All story state lives on the server. The web app keeps nothing in web storage, which the e2e suite already forbids.

Collection `story_progress`, one document per player id:

```js
{
  playerId: "guest_…" | "user_…",
  levels: {
    "paper-town-3": {
      stars: [true, true, false],   // goal, fast, clean: each kept once earned
      attempts: 4,
      clearedAt: Date,              // first clear, absent until cleared
      passedAt: Date,               // set by Pass, absent otherwise
      lastPlayedAt: Date,
    },
  },
  seenScenes: ["prologue", "paper-town-3:intro"],
  settings: { scenes: "first-time" | "always" | "never", chatter: true, extraTime: false },
  xp: { pending: ["story:paper-town-3:star:2"], done: 37 },   // see rewards
  recentMatchIds: [...],           // last 200, so a match is applied once
  version: 12,                     // compare and set, like quest days (ADR-013)
  mergedInto: "user_…",            // set on a transferred guest (ADR-014)
  mergedFrom: ["guest_…"],
  updatedAt: Date,
}
```

Level definitions do not live in the database. They are a static catalogue in `@classicade/shared`
(`src/story/catalogue.js`): districts, levels, characters, goals, star rules, start positions, bot strategy and
parameters, and reward ids. The catalogue is pure data and is checked by a unit test: every level points at an
existing character, strategy, script and reward, ids are unique, and numbering has no gaps.

A level, as data:

```js
{
  id: "paper-town-5",
  district: "paper-town",
  number: 5,
  kind: "rival",                 // tutorial | rival | boss | finale | encore
  gameId: "rps",
  character: "whirly",
  bot: { strategy: "cycle", params: { slipRate: 0.1 } },
  options: { bestOf: 5 },
  rules: { forbiddenChoices: ["scissors"] },
  goal: { type: "win-match" },
  stars: [{ type: "goal" }, { type: "max-rounds", rounds: 6 }, { type: "no-round-lost" }],
  rewards: { avatar: "whirly", xpFirstClear: 30 },
}
```

Goal types: `win-match`, `win-games` (wins before losses), `no-loss-series`, `promote`, `capture-all`,
`capture-points`, `checkmate`, `checkmate-in` (puzzles), `make-line`. Star types: `goal`, `max-rounds`,
`max-moves`, `no-round-lost`, `no-mistakes`, `no-hint`, `first-try`, `all-choices`, `no-triple-repeat`,
`no-piece-lost`, `win-in-first-games`. Each type is one small pure function, so a new level is data only.

How a level is played and scored:

1. `POST /api/story/levels/:levelId/play` checks that the level is open for this player, creates a private bot room
   from the level (CC-193), and answers `{ roomCode }`. If the player already has an open room for that level, it
   answers the same room, so pressing Play twice changes nothing. A locked level answers 409 with the code
   `STORY_LEVEL_LOCKED`.
2. The room runs the game engine wrapped by `withStoryRules(engine, level)` from `packages/games/src/story/`. The
   wrapper rejects forbidden moves with a reason (shown by the shell as "No scissors today"), ends the game when a
   goal is met or failed (promotion, captures, move limits), and accepts a `story-hint` move that changes nothing on
   the board but is written in the move log. Because hints and rules live in the log, `replayGame` reproduces every
   attempt exactly, and the server never trusts the client for stars.
3. When the match is recorded, a new pipeline step after gamification, `storyComponent.applyMatch({ match, now })`,
   runs `scoreLevel({ level, match })` (pure) and merges the result into the player's document: stars only ever turn
   on, `attempts` goes up once per match id, `clearedAt` is set once.
4. The step then publishes `story:updated` to the player's own `player:<id>` room, which the result card uses for its
   star beats.
5. `POST /api/story/levels/:levelId/pass` is allowed after five attempts without a clear.
6. `GET /api/story` returns the whole map state for the player in one small response.
7. `PUT /api/story/settings` and `POST /api/story/scenes/:sceneId/seen` store the settings and seen scenes.

Story reads and writes use the same session identity as everything else. Visitors without a session see the world map
and the first level page. Pressing Play creates a guest session, like "Play as a guest" does today.

### Carry over from guest to account (ADR-014)

`storyComponent` is a transfer participant, added after gamification in `server.js` and `testing/testApp.js`:

1. Mark the guest's document `mergedInto: <account>` (create an empty one if needed).
2. Merge into the account's document, guarded by `mergedFrom` not containing the guest: for every level, a star is on
   if it is on in either document, `attempts` are added, `clearedAt` and `passedAt` keep the earlier date,
   `seenScenes` and `recentMatchIds` are combined, settings keep the account's.
3. Running the transfer twice changes nothing. A partial run resumes through `resumePending`, like every participant.
4. XP needs no story specific step: story XP is ordinary progression XP and moves with progress. Pending XP keys move
   with the document and are paid to the account.

Known trade off: if a guest and the account both cleared the same level before the merge, both earned its story XP
and the account keeps both, as ADR-014 adds progress totals. This is at most 1,960 XP once per guest and the guest
merge caps of CC-095 apply.

### Rewards, without double payment

1. XP keys are permanent and specific: `story:<levelId>:clear` and `story:<levelId>:star:<1|2|3>`.
2. In the same compare and set that turns a star on, its key is added to `xp.pending`. After the update, every pending
   key is paid with `progressAccessor.applyAwardOnce` (source `story`, a new value of `XP_SOURCES`) and then removed
   from `pending`. A crash between the two steps heals on the next story update, and because pending keys are always
   recent they are still inside progression's window of remembered keys. Old keys are never re-sent, so the window can
   never forget them and pay twice.
3. `PROGRESS_UPDATED` with `source: "story"` shows as "Quest star! +10 XP" in the reward queue (CC-099). The
   leaderboard component adds no XP with source `story` to the weekly board, so story XP raises the level but never
   the weekly leaderboard (owner decision 3).
4. Unlocks (avatars, themes, frames) are written to the CC-143 unlock catalogue with `source: { kind: "story",
levelId }`, keyed by player and unlock id, so they are written once.
5. Badges are new achievements whose metric is read from `story_progress`. ADR-013 says achievements give no XP, and
   that stays true.

### Replay

1. Every cleared or passed level can be replayed at any time from the map. Stars already earned stay.
2. A replay earns only the stars still missing, and only their XP.
3. Seen scenes do not play again on replay unless the "scenes" setting is "always". The level page has a "Watch scene"
   button for anyone who wants to see it again.
4. The ending can be watched again from the world map once seen.

### Skipping dialogue

1. Every scene has a Skip button, always visible and the same place: top right of the dialogue panel.
2. Escape skips the current scene. Enter or Space advances one beat. Clicking the panel advances one beat.
3. Text appears at once. There is no typewriter effect, because it slows readers down and is motion.
4. Settings, stored with the story progress: **Story scenes** (always, first time only, never) and **Character
   chatter** (on or off, the in-game bubbles). Both are on the Quest map's settings button and on the level page.
5. Skipping never skips a rule. Tutorials keep their rule card on screen during the game even with scenes off.

### Accessibility

1. **Captions.** All dialogue is text. There is no voice acting. Speaker names are always written out.
2. **Screen readers.** Scene beats go to the shell's polite announcer as "Rocky says: Rock solid!". In-game chatter
   uses the polite region too and is rate limited to one per 4 seconds. Only the result uses the urgent region, as in
   ADR-020. Character art is `aria-hidden`, the speaker's name and mood are in text ("Rocky, happy").
3. **Keyboard.** The map, scenes, hints and result card work with the keyboard alone. Focus never jumps when a bubble
   appears. When a scene closes, focus returns to the control that opened it, or to the board.
4. **Reduced motion.** Expressions swap without the hop, the district relight is a fade, map scrolling is instant, the
   Marquee lights up all at once.
5. **Extra time.** A Quest setting that triples every move timer (GC7 today) and keeps every star available.
6. **Colour.** Stars, locks and goal progress have shapes and text as well as colour. All text meets AA contrast on
   both themes.
7. **Reading.** Lines are short, the font size follows the user's settings, and no text is drawn inside images.
8. **Children.** No chat, no free text, no links out of the site inside the story, no ads. CC-152's under 18 defaults
   apply as everywhere else.

### Sound cues (CC-103)

All sounds are synthesised in the browser through the CC-103 sound module and follow the mute setting.

| Cue              | When                                                    | Sound                                                     |
| ---------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| Voice blip       | Each dialogue beat                                      | Two short soft notes, pitch set per character             |
| Node unlock      | A new level opens on the map                            | A bright single chime                                     |
| Star earned      | Each star beat in the result card                       | Rising notes: first, second and third star a step higher  |
| Goal progress    | A goal step is reached (a capture that counts, a stage) | A short tick                                              |
| Hint             | A hint is shown                                         | A soft "ding"                                             |
| Not allowed      | A forbidden move (no scissors, closed cell)             | The shell's existing "disabled" sound, never harsh        |
| District relight | A boss is cleared                                       | A short three chord fanfare                               |
| Ending           | The Marquee lights up                                   | The fanfare in all three district keys, then a long chord |

Voice pitches: Bit middle, Rocky low, Copycat high, Whirly quick and high, Lulu warm, Crumple middle, Madame Origami
low and slow, Dot very high, Blocky low, Cornelius middle, Mira two notes at once, Nova quick, The Architect very low,
Sir Pawnsley high, Duchess middle and slow, Hopscotch bouncy, Castellan low, Queen Quill middle, King Oldwick lowest.

### Plugging into the game shell (ADR-020) and bot seating (CC-138)

Quest adds no game specific code to the shell. It wraps the game module the shell already uses:

| Shell field    | What Quest does with it                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moments`      | Every game moment (`round-won`, `capture`, `three-in-row` and the rest) is offered to the level script. A matching beat shows a bubble in the dialogue strip. |
| `outcomeText`  | Replaced by the level's goal text: "Goal met: you promoted a pawn" or "The candles burned down. Let's rest and try again." Headline, reason and detail stay.  |
| `requestTypes` | Rematch stays (PT2 teaches it, the bot accepts at once). Draw offers are not available in Quest, bots never accept them (CC-040).                             |
| `scoreboard`   | Adds the goal tracker to the match bar: "Goal: 3 wins", "Points 6 of 10", "★★ 3 of 6 rounds".                                                                 |
| `actions`      | Adds Hint, and at the end Next level, Try again and Map. Pass appears after five attempts. Each disabled action has its reason, per the button standard.      |
| `timers`       | Unchanged. Extra time multiplies the move deadline that the server sets.                                                                                      |
| Result card    | Reward beats in order: result, the rival's line, stars one by one, XP, unlocks, the district relight (bosses), "Save your stars" for guests (bosses only).    |
| New slot       | `storyStrip`, an optional row between the match bar and the board. Only Quest fills it. On mobile it is a single line that expands on tap.                    |

Story moments added on top of the game moments: `hint-used`, `choice-blocked`, `cell-blocked`, `habit` (same RPS
choice twice in a row), `rounds-low`, `missed-win`, `you-blocked`, `they-blocked`, `fork`, `fork-by-you`,
`fork-by-them`, `centre-taken`, `piece-attacked`, `bishop-colour`, `castle-ready`, `en-passant-ready`, `stalemate`,
`stage-won`, `stage-retry`, `series-next`, `match-point`, `time-low`, `time-out`. Each is a pure function over the
previous and the next view, tested beside the level rules.

Bot seating follows CC-138: the story room seats the player and a bot identity whose display name is the character's
name and whose difficulty is the level's strategy id. The room is private: no invite code works for it, it is not
listed, and nobody can spectate. The bot answers a rematch request at once and never offers or accepts a draw. Story
matches are recorded like other bot matches, labelled in match history as "Quest: Paper Town 5 against Whirly", never
counted on leaderboards, and rewarded under ADR-025's bot rules plus the story rewards above.

### Daily return hooks, without dark patterns

What Quest does:

1. **Next rival teaser.** The home page shows one card for players who started Quest: the next open level's character
   and one line ("Whirly is spinning in Paper Town. Ready?"). It disappears after the ending.
2. **Star collection.** The profile shows stars per district and the next reward. The world map shows "3 stars left
   in Grid City".
3. **Encores** open after the ending, for players who want more.
4. **Quests tie in.** One of the daily quest slots may offer "Earn a star in Quest", inside ADR-013's 150 XP daily cap.
5. **Daily puzzle** (CC-144) can borrow Queen Quill as its host once both exist.

What Quest never does:

1. No energy, lives or waiting timers. You can play every open level as often as you like.
2. Nothing expires. No limited time levels, no "come back in 4 hours".
3. No streak that breaks and no penalty for a day off.
4. Nothing to buy. No paid hints, skips, stars or levels, no random boxes. Coins (once they exist) never buy Quest
   progress.
5. No notifications from Quest by default. If CC-147's inbox exists, a player may opt in to one weekly "your rival is
   waiting" note.
6. The "Save your stars" offer appears at most once per district and "Not now" is as large as "Make an account".

### Telemetry

Quest adds one event type to the UX telemetry (CC-173), with the same privacy rules (no player id, no free text):
`quest` with `step` (`map_view`, `level_view`, `start`, `finish`, `retry`, `pass`, `hint`, `scene_skip`,
`ending`), the level id, stars earned (0 to 3), attempts bucket and duration bucket. Funnel events gain `quest_start`
and `quest_first_finish`. The owner dashboard gets a Quest panel with M1 to M13.

---

## 7. Build plan and tests

### Tickets

Next free ID on the board (branch `cc-docs-reserve-101`) is CC-187. These tickets take CC-187 to CC-202, so the
board's next free ID becomes **CC-203** when they are added.

| Order | Ticket | Title                                                                                                                                                                                        | Type    | Pri | Size | Depends on                                         |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --- | ---- | -------------------------------------------------- |
| 1     | CC-187 | ADR-024 story mode: server scored stars, `story_progress`, XP keys and source `story`, transfer participant, URLs, private bot rooms                                                         | docs    | P1  | S    | CC-179                                             |
| 2     | CC-188 | Story catalogue in `@classicade/shared`: districts, 32 levels, 19 characters, goal and star types, reward ids, with a validation test                                                        | feature | P1  | S    | CC-187                                             |
| 3     | CC-189 | Engine options for Quest: chess `startFen`, `untimed` and fixed colours, TTT `startBoard` with closed cells and a fixed starter, the last move in the TTT view, bots read the start position | feature | P1  | M    | CC-038, CC-039, CC-040                             |
| 4     | CC-190 | Character strategies: parameters for `pattern` and the chess levels, new `favourite`, `copycat`, `cycle`, `win-stay`, `practice`, `blocker`, `corners`, `mirror`, `stylist`, `listed: false` | feature | P1  | M    | CC-189, CC-138                                     |
| 5     | CC-191 | Story rules and scoring in `packages/games/src/story/`: `withStoryRules`, goals, stars, mistakes, hints, story moments, stages                                                               | feature | P1  | M    | CC-188, CC-189                                     |
| 6     | CC-192 | Story progress on the server: DAO and contract suite, component, routes, pipeline step, XP awards, `story:updated`, ADR-014 participant                                                      | feature | P1  | M    | CC-191, CC-138, CC-111                             |
| 7     | CC-193 | Story rooms: seat the character bot (CC-138), stages as a series, Try again, hint move, Pass, private rooms, reconnect and Back/Forward rejoin                                               | feature | P1  | M    | CC-192, CC-036                                     |
| 8     | CC-194 | Character art: Bit's story poses, 18 characters with 5 expressions each, district backdrops and map nodes, `CHARACTER_ART`, three new art tokens                                             | feature | P1  | L    | CC-153                                             |
| 9     | CC-195 | Quest map and level pages: `/quest` routes, desktop and mobile layouts, keyboard path, titles, Continue, home teaser card                                                                    | feature | P1  | M    | CC-192 (CC-194 may land later, placeholders first) |
| 10    | CC-196 | Quest in the game shell: dialogue strip slot, moments to beats, goal text, goal tracker, Hint and end actions, star beats in the result card, scene skipping and settings, sounds            | feature | P1  | M    | CC-157, CC-166, CC-167, CC-168, CC-099, CC-103     |
| 11    | CC-197 | Paper Town content: 9 levels, scripts, tutorial rule card, e2e for the whole district on desktop and mobile                                                                                  | feature | P1  | M    | CC-190, CC-193, CC-195, CC-196                     |
| 12    | CC-198 | Grid City content: 9 levels, scripts, start boards, timer level, e2e for the district                                                                                                        | feature | P1  | M    | CC-197                                             |
| 13    | CC-199 | The Kingdom content: 11 levels, start positions and puzzles, piece value card, scripts, e2e for the district                                                                                 | feature | P1  | L    | CC-197                                             |
| 14    | CC-200 | The Marquee, the ending scene and share card, encores, rewards through CC-143 (avatars, themes, frames) and the story badges                                                                 | feature | P1  | M    | CC-198, CC-199, CC-143, CC-034                     |
| 15    | CC-201 | Quest telemetry and dashboard panel, profile star collection, "Earn a star in Quest" daily quest, optional weekly inbox note                                                                 | feature | P2  | S    | CC-173, CC-178, CC-045, CC-197                     |
| 16    | CC-202 | Quest accessibility and journey pass: axe on every Quest screen, screen reader script, reduced motion, Back/Forward chains, guest to account carry over in browsers                          | test    | P1  | M    | CC-200                                             |

CC-197 is the first slice players see: once Paper Town works end to end on the shell, Grid City and The Kingdom are
mostly content. Levels whose rewards need CC-143 show "Reward coming soon" until CC-200 lands, and the rewards are
granted then, because clears are already stored.

### Test plan

**Unit tests** (Vitest, beside the code, deterministic with a seeded rng):

1. Catalogue: every level references a real character, strategy, script and reward. Ids are unique, numbers have no
   gaps, every FEN is legal, every TTT start board is valid, and every puzzle level's solution is confirmed by a search
   in the test itself (mate in 1 and 2 for chess, a full game tree for TTT).
2. Strategies: each property in the strategy table holds over 10,000 seeded turns. Each new strategy passes the bot
   contract kit (pure, fair, never mutates its input, refuses unknown levels). `listed: false` levels never appear in
   the picker list.
3. Story rules: forbidden choices and closed cells are rejected with a reason, goals end the game exactly when met,
   move limits end it kindly, the hint move leaves the board unchanged, and `replayGame` reproduces every attempt.
4. Star scoring, table driven for every level: a scripted log that meets each star alone, all three, and none. Mistake
   detection for TTT (missed win, missed block) and chess (a scripted blunder over the threshold, a fine move under it).
5. Progress merge: stars only turn on, attempts count once per match id, Pass only after five attempts, unlock order,
   Continue picks the right level.
6. XP keys: each key is paid once, a crash between saving and paying heals on the next update, a replay pays only new
   stars.
7. Transfer: the merge rules above, running twice changes nothing, resuming after a partial run works.
8. Web: the map's accessible names, keyboard path, the dialogue strip's rate limit, scene skipping, the result card's
   beat order, every script line within the length and punctuation rules.

**Integration tests** (in-memory MongoDB, real HTTP and sockets):

1. Play on a locked level answers 409 `STORY_LEVEL_LOCKED`. Play twice answers the same room.
2. A scripted Paper Town match against a seeded bot is recorded, scored and published as `story:updated` once.
3. The `story_progress` DAO passes one contract suite against MongoDB and the in-memory double.
4. A guest with stars signs up, and the account has the stars, the XP and the unlocks, and a match that finishes
   during the sign in still counts once.

**End to end tests** (Playwright, `e2e/quest.spec.js`, desktop 1280 by 720 and mobile 390 by 844, the test server
seeds the bot rng so every run plays the same games):

1. A visitor opens `/quest`, plays the prologue, and finishes all of Paper Town as a guest, including the Rematch in
   PT2 and the boss, checking stars on the map after each level.
2. The same journey on mobile, using only the sticky action bar and bottom sheets, with every main control on screen
   without scrolling.
3. Back and Forward: map, district, level, match and back again, Back from the match then Forward into the same room,
   reload on the match URL, a locked level URL, and Next level then Back.
4. Guest to account: a guest earns stars in Paper Town, signs up from the "Save your stars" beat, and sees the same
   stars, the Rocky avatar and the XP on the profile, in another browser too.
5. Skipping: scenes skipped with Escape, the "never" setting, and Watch scene on the level page.
6. Accessibility: axe passes on every Quest screen, reduced motion shows no animation, the screen reader announcements
   arrive in order.
7. Grid City and The Kingdom get one journey each in their content tickets (CC-198, CC-199) and the finale in CC-200.
8. Every test uses the `players` fixture, so console errors, CSP violations and anything in web storage fail it.

### Decisions (owner, 2026-10-17)

These replace the open questions. ADR-024 is accepted with them.

1. **The mascot is named Bit**, and that name is used everywhere: in story mode, for the CC-153 mascot drawing, in
   empty states and on the 404 page.
2. **Story rewards are cosmetic only:** avatars, avatar frames, board themes and skins, and badges. Nothing changes
   how a game plays and nothing is for sale. Quest gives no coins, and the finale stays purely badges and avatars
   (no store bundle).
3. **Story XP counts towards the player's level, but not towards the weekly leaderboard,** so a new player cannot top
   a week with one time rewards. Story matches never count on any leaderboard (bot matches, ADR-025).
