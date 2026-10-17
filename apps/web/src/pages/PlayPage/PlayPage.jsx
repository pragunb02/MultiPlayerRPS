import { useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { ROOM_CODE_LENGTH } from "@classicade/shared";
import { gameForSlug, paths } from "../../app/paths.js";
import { GameArt } from "../../art/games/GameArt.jsx";
import { gameArtFor } from "../../art/games/gameArt.js";
import { Button } from "../../components/Button/Button.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { gameView } from "../../games/registry.js";
import { useAction } from "../../hooks/useAction.js";
import { useCreateRoom } from "../../hooks/useCreateRoom.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import styles from "./PlayPage.module.css";

/**
 * One game's lobby: create a room with the game's options, or join a friend's room by code. Create room shows a
 * spinner while the room is being made and explains a failure under the button. Join room says what is missing
 * while the code is not complete (CC-164).
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

  if (game === undefined) {
    return <NotFoundPage />;
  }
  if (location.pathname !== paths.game(game.id)) {
    return <Navigate to={paths.game(game.id)} replace />;
  }
  const { Options } = gameView(game.id);

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
        <div className={styles.panel}>
          <h2>Start a room</h2>
          {Options && <Options value={options} onChange={setOptions} />}
          <Button control="lobby.create" size="lg" action={create} pendingLabel="Creating…">
            Create room
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
      </div>
    </section>
  );
}
