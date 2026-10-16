import { RPS_CHOICES } from "@classicade/shared";
import { HandPaper } from "../../art/rps/HandPaper.jsx";
import { HandRock } from "../../art/rps/HandRock.jsx";
import { HandScissors } from "../../art/rps/HandScissors.jsx";
import { TurnBanner } from "../../components/TurnBanner/TurnBanner.jsx";
import { useMove } from "../useMove.js";
import styles from "./RpsBoard.module.css";

const CHOICES = Object.freeze([
  { id: RPS_CHOICES.ROCK, label: "Rock", Hand: HandRock },
  { id: RPS_CHOICES.PAPER, label: "Paper", Hand: HandPaper },
  { id: RPS_CHOICES.SCISSORS, label: "Scissors", Hand: HandScissors },
]);

/** A choice's hand, or "?" for a choice this version of the app doesn't know. */
function ChoiceIcon({ choice, className }) {
  const known = CHOICES.find((c) => c.id === choice);
  return known ? <known.Hand className={className} /> : "?";
}

/**
 * The last round, played out: both fists shake three times, then open into the chosen hands. Decoration only —
 * the Rounds list says the same in words. Keyed by round, so each new round plays it once.
 */
function Reveal({ room, round }) {
  return (
    <div className={styles.reveal} aria-hidden="true">
      {room.seats.map((seat, index) => (
        <div key={seat.playerId} className={`${styles.side} ${index === 1 ? styles.mirrored : ""}`}>
          <HandRock className={`${styles.hand} ${styles.shaker}`} />
          <ChoiceIcon choice={round.choices[seat.playerId]} className={`${styles.hand} ${styles.shown}`} />
          <span className={styles.who}>{nameOf(room, seat.playerId)}</span>
        </div>
      ))}
    </div>
  );
}
const nameOf = (room, playerId) =>
  playerId === room.you
    ? "You"
    : (room.seats.find((s) => s.playerId === playerId)?.displayName ?? "Opponent");

/**
 * Rock Paper Scissors. Your own pending choice is shown to you; the opponent's only as "has chosen" — the
 * server never sends it before the round resolves.
 *
 * @param {{ room: any, onMove: (move: { choice: string }) => Promise<unknown> }} props
 */
export function RpsBoard({ room, onMove }) {
  const { view } = room.game;
  const move = useMove(onMove);
  const playing = room.status === "playing";
  const opponent = room.seats.find((seat) => seat.playerId !== room.you);
  const canChoose = playing && room.game.activePlayers.includes(room.you) && !move.busy;

  return (
    <div className={styles.board}>
      <TurnBanner room={room} />
      <p className={styles.score} aria-label="Score">
        {room.seats
          .map((seat) => `${nameOf(room, seat.playerId)} ${view.score[seat.playerId] ?? 0}`)
          .join(" — ")}
        <span className={styles.bestOf}>Best of {view.bestOf}</span>
      </p>

      {view.rounds.length > 0 && (
        <Reveal key={view.rounds.length} room={room} round={view.rounds[view.rounds.length - 1]} />
      )}

      {playing && (
        <>
          <h2 className={styles.round}>Round {view.round}</h2>
          <div className={styles.choices} role="group" aria-label="Your choice">
            {CHOICES.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className={`${styles.choice} ${view.yourChoice === choice.id ? styles.picked : ""}`}
                aria-pressed={view.yourChoice === choice.id}
                disabled={!canChoose}
                onClick={() => move.send({ choice: choice.id })}
              >
                <choice.Hand className={styles.icon} />
                {choice.label}
              </button>
            ))}
          </div>
          {opponent && (
            <p className={styles.status}>
              {view.hasChosen[opponent.playerId]
                ? `${opponent.displayName} has chosen`
                : `${opponent.displayName} is choosing…`}
            </p>
          )}
        </>
      )}
      {move.error !== "" && (
        <p role="alert" className={styles.error}>
          {move.error}
        </p>
      )}

      {view.rounds.length > 0 && (
        <ol className={styles.history} aria-label="Rounds" reversed>
          {[...view.rounds].reverse().map((round, index) => (
            <li key={view.rounds.length - index}>
              {room.seats.map((seat) => (
                <span
                  key={seat.playerId}
                  title={`${nameOf(room, seat.playerId)}: ${round.choices[seat.playerId]}`}
                >
                  <ChoiceIcon choice={round.choices[seat.playerId]} className={styles.mini} />
                </span>
              ))}
              <span className={styles.result}>
                {round.winner === "" ? "Draw" : `${nameOf(room, round.winner)} won`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
