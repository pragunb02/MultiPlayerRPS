import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { characterForGame, ROOM_CODE_LENGTH } from "@classicade/shared";
import { gameForSlug, paths } from "../../app/paths.js";
import { GameArt } from "../../art/games/GameArt.jsx";
import { gameArtFor } from "../../art/games/gameArt.js";
import { Button } from "../../components/Button/Button.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { PlayComputer } from "../../components/PlayComputer/PlayComputer.jsx";
import { HowToPlayFold, HowToPlayStrip } from "../../components/HowToPlay/HowToPlay.jsx";
import { useHowToPlay } from "../../components/HowToPlay/useHowToPlay.js";
import { gameView } from "../../games/registry.js";
import { useAction } from "../../hooks/useAction.js";
import { useCreateRoom } from "../../hooks/useCreateRoom.js";
import { FLAG_STATES, useSteadyFlagState } from "../../hooks/useFlag.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import styles from "./PlayPage.module.css";

/**
 * One game's lobby. The main action plays the game's computer character at once, at the level picked with one tap
 * (CC-221). Below it: create a room with the game's options to invite a friend, or a challenge link with the same
 * options that lasts a day (CC-139), join a friend's room by code, or
 * play with someone beside you on this phone, which is not counted (CC-223).
 * With the `how_to_play` flag on, How to play is one line under the title that opens in place, so a player can
 * read the rules before choosing how to play (CC-349). With it off, the steps are under the cards as before.
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
  const howToPlay = useSteadyFlagState("how_to_play");
  const steps = useHowToPlay(game?.id ?? "");
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
  const playComputer = useAction(
    async (level) => {
      const roomCode = await createRoom.playComputer({ gameId: game.id, level, options: {} });
      navigate(paths.room(game.id, roomCode));
    },
    { id: "lobby.play_computer" },
  );

  if (game === undefined) {
    return <NotFoundPage />;
  }
  if (location.pathname !== paths.game(game.id)) {
    return <Navigate to={paths.game(game.id)} replace />;
  }
  const { Options, passAndPlay, lead = "" } = gameView(game.id);
  // Everything under the title waits for the flag's answer, and for the steps when it is on, so How to play never
  // pushes the cards down after they are drawn. The app asked for the flags early, so this is usually no wait.
  const settled = howToPlay === FLAG_STATES.OFF || (howToPlay === FLAG_STATES.ON && steps !== undefined);
  const character = characterForGame(game.id);

  function join(event) {
    event.preventDefault();
    navigate(paths.room(game.id, code));
  }

  return (
    <section className={styles.page}>
      <PageTitle>{game.name}</PageTitle>
      <div className={`${styles.banner} ${styles[gameArtFor(game.id).tone]}`}>
        <div className={styles.titles}>
          <h1>{game.name}</h1>
          <p className={styles.lead}>{`${lead} Play the computer now, or invite a friend.`.trim()}</p>
        </div>
        <GameArt gameId={game.id} className={styles.art} />
      </div>
      {settled && howToPlay === FLAG_STATES.ON && (
        <HowToPlayFold gameId={game.id} steps={steps} className={styles.howToPlay} />
      )}
      {settled && (
        <div className={styles.panels}>
          <PlayComputer character={character} action={playComputer} />
          <div className={styles.panel}>
            <h2>Play a friend</h2>
            {Options && <Options value={options} onChange={setOptions} />}
            <p className={styles.note}>
              Friend online now? You get a link to send. The game starts when they open it.
            </p>
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
            <Button
              control="lobby.challenge"
              variant="secondary"
              action={challenge}
              pendingLabel="Making it…"
            >
              Make a challenge link
            </Button>
          </div>
          <form className={styles.panel} onSubmit={join}>
            <h2>Join a friend</h2>
            <p className={styles.note}>
              Your friend sees a {ROOM_CODE_LENGTH}-character code on their invite. Type it here.
            </p>
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
              <p className={styles.note}>
                Two players, one phone. Nothing is sent or saved, and it gives no XP.
              </p>
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
      )}
      {howToPlay === FLAG_STATES.OFF && steps !== undefined && (
        <HowToPlayStrip gameId={game.id} steps={steps} />
      )}
    </section>
  );
}
