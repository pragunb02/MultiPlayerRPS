import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { gameForSlug, paths } from "../../app/paths.js";
import { Button } from "../../components/Button/Button.jsx";
import { NOT_COUNTED_NOTE, PassAndPlayShell } from "../../components/MatchShell/PassAndPlayShell.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { checkNames, MAX_NAME_LENGTH } from "../../games/passAndPlay/localMatch.js";
import { gameView } from "../../games/registry.js";
import { useFlag } from "../../hooks/useFlag.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import styles from "./PassAndPlayPage.module.css";

const NOT_LOADED = Object.freeze({ engine: undefined, failed: false });

/**
 * The game's pure engine, loaded once the page opens. `engine` is undefined while it loads, and `failed` turns true
 * when the download fails, for example on a phone that lost its connection after the lobby opened. `retry` tries
 * again. While the page reloads for a newer version the load never settles, so the page just keeps waiting.
 */
function useEngine(passAndPlay) {
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState(NOT_LOADED);
  useEffect(() => {
    passAndPlay.loadEngine().then(
      (engine) => setLoad({ engine, failed: false }),
      () => setLoad({ engine: undefined, failed: true }),
    );
  }, [passAndPlay, attempt]);
  const retry = () => {
    setLoad(NOT_LOADED);
    setAttempt(attempt + 1);
  };
  return { ...load, retry };
}

/** Why Start cannot be pressed yet, in the player's words, or "" when it can. */
function startReason({ load, names }) {
  if (load.failed) return "The game could not load";
  if (load.engine === undefined) return "Loading the game";
  return names.ok ? "" : names.reason;
}

/**
 * The setup and the game, once the game has pass and play (CC-223). The names are typed here and live only in this
 * page's memory: they are never sent, never put in the address and never stored, so a reload starts again here.
 */
function PassAndPlay({ game, entry }) {
  const navigate = useNavigate();
  const load = useEngine(entry.passAndPlay);
  const [typed, setTyped] = useState(["", ""]);
  const [options, setOptions] = useState({});
  const [started, setStarted] = useState(undefined);
  // Asked on the setup screen, so the game itself never talks to the server (CC-349).
  const howToPlay = useFlag("how_to_play");
  const { Options } = entry;
  const names = checkNames(typed);
  const reason = startReason({ load, names });

  // Leaving replaces this page, so Back from the lobby does not come back to a game that is gone.
  const leave = () => navigate(paths.game(game.id), { replace: true });

  if (started !== undefined) {
    return (
      <PassAndPlayShell
        gameId={game.id}
        gameName={game.name}
        game={entry}
        engine={load.engine}
        names={started.names}
        options={started.options}
        onLeave={leave}
        howToPlay={howToPlay}
      />
    );
  }

  function start(event) {
    event.preventDefault();
    setStarted({ names: names.names, options });
  }

  const nameField = (index) => (
    <label>
      Player {index + 1}
      <input
        value={typed[index]}
        onChange={(event) => setTyped(typed.map((name, at) => (at === index ? event.target.value : name)))}
        maxLength={MAX_NAME_LENGTH}
        autoComplete="off"
        placeholder={`Player ${index + 1}`}
      />
    </label>
  );

  return (
    <section className={styles.page}>
      <PageTitle>{`${game.name} · Pass and play`}</PageTitle>
      <h1>{game.name}: pass and play</h1>
      <p className={styles.lead}>Two players take turns on this phone.</p>
      <form className={styles.panel} onSubmit={start}>
        {nameField(0)}
        {nameField(1)}
        {Options && <Options value={options} onChange={setOptions} />}
        <p className={styles.small}>Names stay on this phone. Nothing about the game is sent or saved.</p>
        <p className={styles.small}>{NOT_COUNTED_NOTE}</p>
        {load.failed && (
          <div className={styles.failure}>
            <p role="alert">The game could not load. Check your connection and try again.</p>
            <Button control="pass.retry" variant="secondary" onClick={load.retry}>
              Try again
            </Button>
          </div>
        )}
        <Button control="pass.start" type="submit" size="lg" reason={reason}>
          Start game
        </Button>
      </form>
    </section>
  );
}

/**
 * Pass and play for one game, at `/games/:slug/pass-and-play` (CC-223). A game without pass and play in the client
 * registry is not found here. Any other spelling of the address is replaced by the canonical one.
 */
export function PassAndPlayPage() {
  const { slug } = useParams();
  const location = useLocation();
  const game = gameForSlug(slug);
  const entry = game === undefined ? undefined : gameView(game.id);
  if (entry?.passAndPlay === undefined) {
    return <NotFoundPage />;
  }
  if (location.pathname !== paths.passAndPlay(game.id)) {
    return <Navigate to={paths.passAndPlay(game.id)} replace />;
  }
  return <PassAndPlay key={game.id} game={game} entry={entry} />;
}
