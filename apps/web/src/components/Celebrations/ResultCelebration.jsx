import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AchievementIcon } from "../../art/achievements/AchievementIcon.jsx";
import { Confetti } from "../../art/effects/Confetti.jsx";
import { XpPop } from "../../art/effects/XpPop.jsx";
import { MOMENT_MS } from "../../games/outcomeMoment.js";
import { CATEGORIES } from "../../lib/notify/categories.js";
import { isUncountedMatch, notCountedMessage } from "../notCounted.js";
import { useHold } from "../Toast/toastContext.js";
import { useMatchProgress } from "./matchProgressContext.js";
import styles from "./ResultCelebration.module.css";

/**
 * While the outcome moment plays, the result holds the screen, so toasts of a lower category (rewards, other
 * players) wait and come one beat after it (CC-099 beat 1, CC-208). A request and a lost connection matter more and
 * still show at once. A result that was already there when the page opened (a reload) is no new moment, so it
 * holds nothing, just as it plays no sound.
 *
 * @param {boolean} live  whether the game ended while the viewer watched
 */
function useMomentHold(live) {
  const [playing, setPlaying] = useState(live);
  useEffect(() => {
    if (!live) return undefined;
    const timer = setTimeout(() => setPlaying(false), MOMENT_MS);
    return () => clearTimeout(timer);
  }, [live]);
  useHold(CATEGORIES.RESULT, playing);
}

/**
 * The result beat when a game ends (CC-163): the outcome moment's stamp, the gold trophy of a quiet win, confetti
 * for a win earned on the board, and the XP earned rising out of it once the server has recorded the match. It is
 * all decoration over the result headline and its line, which say everything in words and are read out by the
 * match's announcer, so it is hidden from screen readers. Under reduced motion the stamp and the trophy stay and
 * nothing moves. A game that didn't count (CC-095) says why under the stamp, and the toast announces the same
 * words. Both come from the match's own progress update, which may have arrived before this was on screen (CC-235).
 *
 * @param {{
 *   room: { game: { matchId: string } },
 *   moment: Readonly<import("../../games/outcomeMoment.js").OutcomeMoment>,
 *   live: boolean,
 * }} props  `moment` is the room's outcome moment (outcomeMoment). `live` says whether the game ended while the
 *   viewer watched, rather than before the page opened
 */
export function ResultCelebration({ room, moment, live }) {
  useMomentHold(live);
  const update = useMatchProgress(room.game.matchId);
  const xp = update === undefined ? 0 : update.xpGained;
  const notCounted =
    update !== undefined && isUncountedMatch(update) ? notCountedMessage(update.notCountedReason) : "";

  return (
    <div
      className={styles.celebration}
      data-cc-moment={moment.ending}
      data-cc-tone={moment.tone}
      aria-hidden="true"
    >
      {moment.stamp !== "" && (
        <span className={styles.stamp} data-cc-stamp="">
          {moment.icon !== "" && (
            <span className={styles.icon} data-cc-icon={moment.icon}>
              <AchievementIcon name={moment.icon} tier="gold" />
            </span>
          )}
          {moment.stamp}
        </span>
      )}
      {xp > 0 && <XpPop xp={xp} />}
      {notCounted !== "" && <p className={styles.notCounted}>{notCounted}</p>}
      {moment.effect === "confetti" && createPortal(<Confetti />, document.body)}
    </div>
  );
}
