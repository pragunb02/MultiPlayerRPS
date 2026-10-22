import { useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { characterForGame, ROOM_CODE_LENGTH } from "@classicade/shared";
import { gameForSlug, paths } from "../../app/paths.js";
import { GameArt } from "../../art/games/GameArt.jsx";
import { gameArtFor } from "../../art/games/gameArt.js";
import { Button } from "../../components/Button/Button.jsx";
import { Card, CardBody, CardHeader } from "../../components/Card/Card.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { PlayComputer } from "../../components/PlayComputer/PlayComputer.jsx";
import { gameView } from "../../games/registry.js";
import { useAction } from "../../hooks/useAction.js";
import { useCreateRoom } from "../../hooks/useCreateRoom.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import { HowToPlay } from "./HowToPlay.jsx";
import styles from "./PlayPage.module.css";

/**
 * One game's lobby. The main action plays the game's computer character at once, at the level picked with one tap
 * (CC-221). Below it: create a room with the game's options to invite a friend, or a challenge link with the same
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
  const { Options, passAndPlay } = gameView(game.id);
  const character = characterForGame(game.id);

  function join(event) {
    event.preventDefault();
    navigate(paths.room(game.id, code));
  }

  return (
    <section>
      <PageTitle>{game.name}</PageTitle>
      <Card as="div" variant="accent" tone={gameArtFor(game.id).tone} className={styles.banner}>
        <h1>{game.name}</h1>
        <GameArt gameId={game.id} className={styles.art} />
      </Card>
      <div className={styles.panels}>
        <PlayComputer character={character} action={playComputer} />
        <Card as="section" aria-labelledby="lobby-friend">
          <CardHeader id="lobby-friend" title="Play a friend" titleAs="h2" />
          <CardBody>
            {Options && (
              <div className={styles.options}>
                <Options value={options} onChange={setOptions} />
              </div>
            )}
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
          </CardBody>
        </Card>
        <Card as="form" onSubmit={join} aria-labelledby="lobby-join">
          <CardHeader id="lobby-join" title="Join a friend" titleAs="h2" />
          <CardBody>
            <Field
              label="Room code"
              className={styles.code}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={ROOM_CODE_LENGTH}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="AB2CD3"
            />
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
          </CardBody>
        </Card>
        {passAndPlay && (
          <Card as="section" aria-labelledby="lobby-pass">
            <CardHeader
              id="lobby-pass"
              title="Pass and play"
              titleAs="h2"
              description="Two players, one phone. Not counted, nothing is sent or saved."
            />
            <CardBody>
              <Button
                as="link"
                to={paths.passAndPlay(game.id)}
                control="lobby.pass_and_play"
                variant="secondary"
                size="lg"
              >
                Play on this phone
              </Button>
            </CardBody>
          </Card>
        )}
      </div>
      <HowToPlay gameId={game.id} />
    </section>
  );
}
