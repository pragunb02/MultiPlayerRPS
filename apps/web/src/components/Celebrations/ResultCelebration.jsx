import { createPortal } from "react-dom";
import { Confetti } from "../../art/effects/Confetti.jsx";
import { XpPop } from "../../art/effects/XpPop.jsx";
import { isUncountedMatch, notCountedMessage } from "../notCounted.js";
import { useMatchProgress } from "./matchProgressContext.js";
import { outcomeFor } from "./outcome.js";
import styles from "./ResultCelebration.module.css";

const BANNERS = Object.freeze({
  win: "Victory!",
  loss: "Defeat",
  draw: "Draw",
  watched: "Game over",
});

/**
 * The reward beat when a game ends: a big result banner, confetti for a win, and the XP earned rising out of it
 * once the server has recorded the match. All of it is decoration over the room's own result text ("You won!",
 * announced in its status region) and the XP toast, so it is hidden from screen readers and skipped (except the
 * static banner) under reduced motion. A game that didn't count (CC-095) says why under the banner, and the toast
 * announces the same words. Both come from the match's own progress update, which may have arrived before this was
 * on screen (CC-235). A quest bonus that follows has its own toast and pop (GamificationToasts).
 *
 * @param {{ room: { you: string, game: { matchId: string, outcome: { result: string, winners: string[] } } } }} props
 */
export function ResultCelebration({ room }) {
  const update = useMatchProgress(room.game.matchId);
  const outcome = outcomeFor(room);
  const xp = update === undefined ? 0 : update.xpGained;
  const notCounted =
    update !== undefined && isUncountedMatch(update) ? notCountedMessage(update.notCountedReason) : "";

  return (
    <div className={`${styles.celebration} ${styles[outcome]}`} aria-hidden="true">
      <span className={styles.banner}>{BANNERS[outcome]}</span>
      {xp > 0 && <XpPop xp={xp} />}
      {notCounted !== "" && <p className={styles.notCounted}>{notCounted}</p>}
      {outcome === "win" && createPortal(<Confetti />, document.body)}
    </div>
  );
}
