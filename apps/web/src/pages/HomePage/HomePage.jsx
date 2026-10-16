import { useState } from "react";
import { Link } from "react-router";
import { paths } from "../../app/paths.js";
import { Button } from "../../components/Button/Button.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { DailyQuests } from "../../components/Quests/DailyQuests.jsx";
import { useGames } from "../../hooks/useGames.js";
import { useSession } from "../../hooks/useSession.js";
import styles from "./HomePage.module.css";

/** Landing page: what ClassiCade is, the game catalog, and one click to start playing as a guest. */
export function HomePage() {
  const games = useGames();
  const session = useSession();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setStarting(true);
    setError("");
    try {
      await session.ensurePlayer();
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <PageTitle />
      <section className={styles.hero}>
        <h1>Play the classics with anyone, in one click.</h1>
        <p className={styles.lead}>No downloads, no signup required. Pick a game, share a link, play.</p>
        {session.status === "ready" ? (
          <p className={styles.ready}>You're playing as {session.identity.displayName}.</p>
        ) : (
          <Button size="lg" onClick={start} busy={starting} disabled={session.status === "loading"}>
            Play as a guest
          </Button>
        )}
        {error !== "" && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </section>

      {session.status === "ready" && <DailyQuests compact />}

      <section aria-labelledby="games-heading">
        <h2 id="games-heading">Games</h2>
        {games.status === "loading" && <p>Loading games…</p>}
        {games.status === "error" && <p role="alert">Couldn't load games. {games.error.message}</p>}
        {games.status === "ready" && (
          <ul className={styles.games}>
            {games.games.map((game) => (
              <li key={game.id} className={styles.card}>
                <h3>
                  <Link to={paths.game(game.id)} className={styles.cardLink}>
                    {game.name}
                  </Link>
                </h3>
                <p className={styles.meta}>
                  {game.minPlayers === game.maxPlayers
                    ? `${game.minPlayers} players`
                    : `${game.minPlayers}–${game.maxPlayers} players`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
