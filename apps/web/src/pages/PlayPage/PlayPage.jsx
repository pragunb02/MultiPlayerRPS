import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { characterForGame, QUICK_MATCH_OUTCOMES, ROOM_CODE_LENGTH } from "@classicade/shared";
import { gameForSlug, paths } from "../../app/paths.js";
import { GameArt } from "../../art/games/GameArt.jsx";
import { gameArtFor } from "../../art/games/gameArt.js";
import { Button } from "../../components/Button/Button.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { PlayComputer } from "../../components/PlayComputer/PlayComputer.jsx";
import { gameView } from "../../games/registry.js";
import { useToast } from "../../components/Toast/toastContext.js";
import { useAction } from "../../hooks/useAction.js";
import { useCreateRoom } from "../../hooks/useCreateRoom.js";
import { useFlag } from "../../hooks/useFlag.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import { HowToPlay } from "./HowToPlay.jsx";
import styles from "./PlayPage.module.css";

/**
 * One game's lobby. The main action plays the game's computer character at once, at the level picked with one tap
 * (CC-221). With quick match on (CC-051, the `quick_match` flag) it looks for a person first, for a few seconds,
 * and plays the character when nobody is free; leaving or hiding the page cancels the search. Below it: create a room with the game's options to invite a friend, or a challenge link with the same
 * options that lasts a day (CC-139), join a friend's room by code, or
 * play with someone beside you on this phone, which is not counted (CC-223).
 * Each button shows a spinner while the server works and explains a failure under it. Join room says what is
 * missing while the code is not complete (CC-164).
 */
export function PlayPage() {
  const { slug } = useParams();
  const location = useLocation();
  const game = gameForSlug(slug);
  const navigate = useNavigate();
  const createRoom = useCreateRoom();
  const [options, setOptions] = useState({});
  const [code, setCode] = useState("");
  const create = useAction(
    async () => {
      const roomCode = await createRoom.create(game.id, options);
      navigate(paths.room(game.id, roomCode));
    },
    { id: "lobby.create" },
  );
  const challenge = useAction(
    async () => {
      const id = await createRoom.challenge({ gameId: game.id, options });
      navigate(paths.challenge(id));
    },
    { id: "lobby.challenge" },
  );
  const quickMatchOn = useFlag("quick_match");
  const toast = useToast();
  const searching = useRef(false);
  const [searchStarted, setSearchStarted] = useState(false);
  const { cancelQuickMatch } = createRoom;
  const playComputer = useAction(
    async (level) => {
      if (!quickMatchOn) {
        const roomCode = await createRoom.playComputer({ gameId: game.id, level, options: {} });
        navigate(paths.room(game.id, roomCode));
        return;
      }
      searching.current = true;
      // A visitor becomes a guest on this press, and the flag is asked again for the guest. The search started
      // under the flag keeps showing as one meanwhile.
      setSearchStarted(true);
      try {
        const { outcome, code: roomCode } = await createRoom.quickMatch({ gameId: game.id, level });
        if (outcome === QUICK_MATCH_OUTCOMES.CANCELLED) return;
        if (outcome === QUICK_MATCH_OUTCOMES.CHARACTER) {
          toast.show(`Nobody was free just now, so you're playing ${characterForGame(game.id).name}.`, {
            tone: "info",
          });
        }
        navigate(paths.room(game.id, roomCode));
      } finally {
        searching.current = false;
        setSearchStarted(false);
      }
    },
    { id: "lobby.play_computer" },
  );
  // A search ends when the page is left or hidden (CC-051): a player who is not looking must not be paired.
  useEffect(() => {
    const cancelIfSearching = () => {
      if (searching.current) cancelQuickMatch();
    };
    const onVisibility = () => document.visibilityState === "hidden" && cancelIfSearching();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelIfSearching();
    };
  }, [cancelQuickMatch]);

  if (game === undefined) {
    return <NotFoundPage />;
  }
  if (location.pathname !== paths.game(game.id)) {
    return <Navigate to={paths.game(game.id)} replace />;
  }
  const { Options, passAndPlay } = gameView(game.id);
  const character = characterForGame(game.id);

  function join(event) {
    event.preventDefault();
    navigate(paths.room(game.id, code));
  }

  return (
    <section className={styles.page}>
      <PageTitle>{game.name}</PageTitle>
      <div className={`${styles.banner} ${styles[gameArtFor(game.id).tone]}`}>
        <h1>{game.name}</h1>
        <GameArt gameId={game.id} className={styles.art} />
      </div>
      <div className={styles.panels}>
        <PlayComputer
          character={character}
          action={playComputer}
          quickMatch={quickMatchOn || searchStarted ? { onCancel: cancelQuickMatch } : undefined}
        />
        <div className={styles.panel}>
          <h2>Play a friend</h2>
          {Options && <Options value={options} onChange={setOptions} />}
          <Button
            control="lobby.create"
            variant="secondary"
            size="lg"
            action={create}
            pendingLabel="Creating…"
          >
            Create room
          </Button>
          <p className={styles.note}>Friend not online now? Send a challenge link. It lasts 24 hours.</p>
          <Button control="lobby.challenge" variant="secondary" action={challenge} pendingLabel="Making it…">
            Make a challenge link
          </Button>
        </div>
        <form className={styles.panel} onSubmit={join}>
          <h2>Join a friend</h2>
          <label>
            Room code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={ROOM_CODE_LENGTH}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="AB2CD3"
            />
          </label>
          <Button
            control="lobby.join"
            type="submit"
            variant="secondary"
            size="lg"
            reason={
              code.trim().length === ROOM_CODE_LENGTH
                ? ""
                : `Enter the ${ROOM_CODE_LENGTH}-character room code`
            }
          >
            Join room
          </Button>
        </form>
        {passAndPlay && (
          <div className={styles.panel}>
            <h2>Pass and play</h2>
            <p className={styles.note}>Two players, one phone. Not counted, nothing is sent or saved.</p>
            <Link
              to={paths.passAndPlay(game.id)}
              className={styles.link}
              data-cc-control="lobby.pass_and_play"
            >
              Play on this phone
            </Link>
          </div>
        )}
      </div>
      <HowToPlay gameId={game.id} />
    </section>
  );
}
