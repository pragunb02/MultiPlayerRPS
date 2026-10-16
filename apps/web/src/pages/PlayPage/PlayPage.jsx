import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { getGame, ROOM_CODE_LENGTH } from "@classicade/shared";
import { Button } from "../../components/Button/Button.jsx";
import { gameView } from "../../games/registry.js";
import { useCreateRoom } from "../../hooks/useCreateRoom.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import styles from "./PlayPage.module.css";

/** One game's lobby: create a room with the game's options, or join a friend's room by code. */
export function PlayPage() {
  const { gameId } = useParams();
  const game = getGame(gameId);
  const navigate = useNavigate();
  const createRoom = useCreateRoom();
  const [options, setOptions] = useState({});
  const [code, setCode] = useState("");

  if (game === undefined) {
    return <NotFoundPage />;
  }
  const { Options } = gameView(game.id);

  async function create() {
    const roomCode = await createRoom.create(game.id, options).catch(() => undefined);
    if (roomCode !== undefined) {
      navigate(`/room/${roomCode}`);
    }
  }

  function join(event) {
    event.preventDefault();
    navigate(`/room/${code.trim().toUpperCase()}`);
  }

  return (
    <section className={styles.page}>
      <h1>{game.name}</h1>
      <div className={styles.panels}>
        <div className={styles.panel}>
          <h2>Start a room</h2>
          {Options && <Options value={options} onChange={setOptions} />}
          <Button size="lg" onClick={create} busy={createRoom.busy}>
            Create room
          </Button>
          {createRoom.error && (
            <p role="alert" className={styles.error}>
              {createRoom.error.message}
            </p>
          )}
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
            type="submit"
            variant="secondary"
            size="lg"
            disabled={code.trim().length !== ROOM_CODE_LENGTH}
          >
            Join room
          </Button>
        </form>
      </div>
    </section>
  );
}
