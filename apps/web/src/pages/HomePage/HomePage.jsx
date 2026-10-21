import { Suspense } from "react";
import { DAILY_PUZZLES } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { GameArt } from "../../art/games/GameArt.jsx";
import { gameArtFor } from "../../art/games/gameArt.js";
import { Button } from "../../components/Button/Button.jsx";
import { Card, CardHeader, CardLink, CardMedia } from "../../components/Card/Card.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { DailyQuests } from "../../components/Quests/DailyQuests.jsx";
import { ErrorState, Skeleton } from "../../components/States/States.jsx";
import { lazyBoard } from "../../games/lazyBoard.js";
import { useAction } from "../../hooks/useAction.js";
import { useGames } from "../../hooks/useGames.js";
import { useSession } from "../../hooks/useSession.js";
import styles from "./HomePage.module.css";

// The hero scene is the biggest picture in the app: it loads in its own chunk, after the page itself. Like a board,
// it waits quietly when its file fails because the page is reloading or leaving (lazyBoard.js, CC-184 F-8).
const HeroArt = lazyBoard(() => import("../../art/HeroArt.jsx"), "HeroArt");

/**
 * The word at the end of a tile's title row that says where the tile goes. The whole tile is the link, so this is
 * a cue only, hidden from screen readers, and drawn as words, not as a fourth kind of button (CC-323).
 */
function Go({ children }) {
  return (
    <span className={styles.go} aria-hidden="true">
      {children} <span className={styles.arrow}>›</span>
    </span>
  );
}

/** Landing page: what ClassiCade is, the game catalog, and one click to start playing as a guest. */
export function HomePage() {
  const games = useGames();
  const session = useSession();
  const start = useAction(session.ensurePlayer, { id: "home.play_guest" });

  return (
    <>
      <PageTitle />
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <h1>Play the classics with anyone, in one click.</h1>
          <p className={styles.lead}>No downloads, no signup required. Pick a game, share a link, play.</p>
          {session.status === "ready" ? (
            <p className={styles.ready}>You're playing as {session.identity.displayName}.</p>
          ) : (
            <Button
              control="home.play_guest"
              size="lg"
              variant="accent"
              action={start}
              reason={session.status === "loading" ? "Checking whether you are signed in" : ""}
            >
              Play as a guest
            </Button>
          )}
        </div>
        <div className={styles.heroArt}>
          <Suspense fallback={null}>
            <HeroArt />
          </Suspense>
        </div>
      </section>

      {session.status === "ready" && <DailyQuests compact />}

      <section aria-labelledby="games-heading">
        <h2 id="games-heading">Games</h2>
        {games.status === "loading" && (
          <Skeleton label="Loading the games" shape="card" count={3} className={styles.games} />
        )}
        {games.status === "error" && (
          <ErrorState title="Couldn't load the games." control="home.games">
            {games.error.message}
          </ErrorState>
        )}
        {games.status === "ready" && (
          <ul className={styles.games}>
            {games.games.map((game) => (
              <Card key={game.id} as="li" variant="accent" tone={gameArtFor(game.id).tone} interactive>
                <CardMedia className={styles.art}>
                  <GameArt gameId={game.id} />
                </CardMedia>
                <CardHeader
                  title={
                    <CardLink to={paths.game(game.id)} control="home.game">
                      {game.name}
                    </CardLink>
                  }
                  description={
                    game.minPlayers === game.maxPlayers
                      ? `${game.minPlayers} players`
                      : `${game.minPlayers}–${game.maxPlayers} players`
                  }
                  aside={<Go>Play</Go>}
                />
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="daily-heading" className={styles.daily}>
        <h2 id="daily-heading">Daily puzzle</h2>
        <ul className={styles.games}>
          {DAILY_PUZZLES.map((puzzle) => (
            <Card key={puzzle.id} as="li" variant="accent" tone={gameArtFor(puzzle.gameId).tone} interactive>
              <CardHeader
                title={
                  <CardLink to={paths.daily(puzzle.id)} control="home.daily">
                    Today&apos;s puzzle
                  </CardLink>
                }
                description="A new chess puzzle every day, the same for everyone. Keep your streak going."
                aside={<Go>Solve</Go>}
              />
            </Card>
          ))}
        </ul>
      </section>
    </>
  );
}
