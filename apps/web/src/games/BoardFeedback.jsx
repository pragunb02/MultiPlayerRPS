import { Button } from "../components/Button/Button.jsx";
import styles from "./BoardFeedback.module.css";

/**
 * Why the square or cell just pressed cannot be played (CC-164): "Not your turn", "Cell taken". The line is
 * always there and empty, so a screen reader announces each new reason. It is keyed by the press, so pressing
 * again shows and announces it again.
 *
 * @param {{ explanation: ReturnType<typeof import("../hooks/useExplanation.js").useExplanation> }} props
 */
export function ReasonLine({ explanation }) {
  return (
    <p className={styles.reason} role="status">
      {explanation.reason !== "" && (
        <span key={explanation.count} className={styles.text}>
          {explanation.reason}
        </span>
      )}
    </p>
  );
}

/**
 * The last move the server refused, and Retry when the connection was the problem (CC-164).
 *
 * @param {{ move: ReturnType<typeof import("./useMove.js").useMove> }} props
 */
export function MoveProblem({ move }) {
  if (move.error === "") {
    return null;
  }
  return (
    <p role="alert" className={styles.error}>
      {move.error}
      {move.action.error.retryable && (
        <Button control={`${move.action.id}.retry`} variant="secondary" onClick={() => move.action.retry()}>
          Retry
        </Button>
      )}
    </p>
  );
}
