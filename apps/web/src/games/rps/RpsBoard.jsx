import { RPS_CHOICES } from "@classicade/shared";
import { HandPaper } from "../../art/rps/HandPaper.jsx";
import { HandRock } from "../../art/rps/HandRock.jsx";
import { HandScissors } from "../../art/rps/HandScissors.jsx";
import { TurnBanner } from "../../components/TurnBanner/TurnBanner.jsx";
import { useExplanation } from "../../hooks/useExplanation.js";
import { MoveProblem, ReasonLine } from "../BoardFeedback.jsx";
import { PLAY_REASONS, playReason } from "../roomView.js";
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
 * Why no hand can be chosen now. Both players choose at once in each round, so "not your turn" can only mean
 * you chose and wait for the other player, and the reason says so.
 */
function choiceReason({ reason, opponent, busy }) {
  if (reason === PLAY_REASONS.NOT_YOUR_TURN) {
    return `Waiting for ${opponent.displayName}`;
  }
  if (reason === "" && busy) {
    return "Sending your choice";
  }
  return reason;
}

/**
 * Rock Paper Scissors. Your own pending choice is shown to you. The opponent's shows only as "has chosen",
 * because the server never sends it before the round resolves. The pressed hand lights up at once, and a hand
 * that cannot be chosen says why when pressed (CC-164).
 *
 * @param {{ room: any, onMove: (move: { choice: string }) => Promise<unknown>, reason?: string }} props
 *   `reason`: why the viewer cannot play now (see playReason), empty when they can
 */
export function RpsBoard({ room, onMove, reason = playReason(room, { reconnecting: false }) }) {
  const { view } = room.game;
  const move = useMove(onMove, { id: "rps.choice" });
  const explanation = useExplanation();
  const playing = room.status === "playing";
  const opponent = room.seats.find((seat) => seat.playerId !== room.you);
  const chosen = move.sent?.choice ?? view.yourChoice;
  const why = choiceReason({ reason, opponent, busy: move.busy });

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
                className={`${styles.choice} ${chosen === choice.id ? styles.picked : ""}`}
                aria-pressed={chosen === choice.id}
                aria-disabled={why !== "" ? "true" : undefined}
                aria-busy={move.sent?.choice === choice.id && move.pending ? "true" : undefined}
                data-cc-control="rps.choice"
                onClick={() => (why === "" ? move.send({ choice: choice.id }) : explanation.explain(why))}
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
      {playing && <ReasonLine explanation={explanation} />}
      <MoveProblem move={move} />

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
