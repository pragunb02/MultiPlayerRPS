import { Suspense } from "react";
import { Link } from "react-router";
import { DAILY_PUZZLES } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { GameArt } from "../../art/games/GameArt.jsx";
import { gameArtFor } from "../../art/games/gameArt.js";
import { Button } from "../../components/Button/Button.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { DailyQuests } from "../../components/Quests/DailyQuests.jsx";
import { lazyBoard } from "../../games/lazyBoard.js";
import { useAction } from "../../hooks/useAction.js";
import { useGames } from "../../hooks/useGames.js";
import { useSession } from "../../hooks/useSession.js";
import styles from "./HomePage.module.css";

// The hero scene is the biggest picture in the app: it loads in its own chunk, after the page itself. Like a board,
// it waits quietly when its file fails because the page is reloading or leaving (lazyBoard.js, CC-184 F-8).
const HeroArt = lazyBoard(() => import("../../art/HeroArt.jsx"), "HeroArt");

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
        {games.status === "loading" && <p>Loading games…</p>}
        {games.status === "error" && <p role="alert">Couldn't load games. {games.error.message}</p>}
        {games.status === "ready" && (
          <ul className={styles.games}>
            {games.games.map((game) => (
              <li key={game.id} className={`${styles.card} ${styles[gameArtFor(game.id).tone]}`}>
                <div className={styles.cardArt}>
                  <GameArt gameId={game.id} />
                </div>
                <h3>
                  <Link to={paths.game(game.id)} className={styles.cardLink} data-cc-control="home.game">
                    {game.name}
                  </Link>
                </h3>
                <p className={styles.meta}>
                  {game.minPlayers === game.maxPlayers
                    ? `${game.minPlayers} players`
                    : `${game.minPlayers}–${game.maxPlayers} players`}
                </p>
                <span className={styles.play} aria-hidden="true">
                  Play
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="daily-heading" className={styles.daily}>
        <h2 id="daily-heading">Daily puzzle</h2>
        <ul className={styles.games}>
          {DAILY_PUZZLES.map((puzzle) => (
            <li key={puzzle.id} className={`${styles.card} ${styles[gameArtFor(puzzle.gameId).tone]}`}>
              <h3>
                <Link to={paths.daily(puzzle.id)} className={styles.cardLink} data-cc-control="home.daily">
                  Today&apos;s puzzle
                </Link>
              </h3>
              <p className={styles.meta}>
                A new chess puzzle every day, the same for everyone. Keep your streak going.
              </p>
              <span className={styles.play} aria-hidden="true">
                Solve
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
