import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../../app/servicesContext.js";
import { Confetti } from "../../art/effects/Confetti.jsx";
import { XpPop } from "../../art/effects/XpPop.jsx";
import { isUncountedMatch, notCountedMessage } from "../notCounted.js";
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
 * announces the same words.
 *
 * @param {{ room: { you: string, game: { outcome: { result: string, winners: string[] } } } }} props
 */
export function ResultCelebration({ room }) {
  const { socket } = useServices();
  const [xp, setXp] = useState(0);
  const [notCounted, setNotCounted] = useState("");
  const outcome = outcomeFor(room);

  // The match's own XP; a quest bonus that follows it has its own toast and pop (GamificationToasts).
  useEffect(
    () =>
      socket.on(SOCKET_EVENTS.PROGRESS_UPDATED, (update) => {
        if (update.source === "quest") return;
        setXp(update.xpGained);
        setNotCounted(isUncountedMatch(update) ? notCountedMessage(update.notCountedReason) : "");
      }),
    [socket],
  );

  return (
    <div className={`${styles.celebration} ${styles[outcome]}`} aria-hidden="true">
      <span className={styles.banner}>{BANNERS[outcome]}</span>
      {xp > 0 && <XpPop xp={xp} />}
      {notCounted !== "" && <p className={styles.notCounted}>{notCounted}</p>}
      {outcome === "win" && createPortal(<Confetti />, document.body)}
    </div>
  );
}
