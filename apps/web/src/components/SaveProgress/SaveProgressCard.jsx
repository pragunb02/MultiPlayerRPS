import { useEffect, useId } from "react";
import { Link, useLocation } from "react-router";
import { paths, returnPathFor } from "../../app/paths.js";
import { LevelBadge } from "../../art/badges/LevelBadge.jsx";
import { StreakFlame } from "../../art/effects/StreakFlame.jsx";
import { outcomeFor } from "../Celebrations/outcome.js";
import { DismissButton } from "../DismissButton/DismissButton.jsx";
import { PROMPTS, useSaveProgress } from "./saveProgressContext.js";
import { winWorthSaving } from "./savedMessage.js";
import styles from "./SaveProgressCard.module.css";

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * "Save your progress", under a guest's win in the room's result area (CC-097): what an account would keep —
 * level, XP, wins and the daily streak, live from the guest's own numbers — with sign up and log in links that
 * come straight back to this room. Shown after the first win, and later for a win once the guest has some XP, at
 * most once per room; closing it closes it for the rest of the visit. Nobody else ever sees it.
 *
 * @param {{ room: { code: string, you: string, game: { outcome: { result: string, winners: string[] } } }, game: number }} props
 *   `game`: which game of the room this is (0 = the first, each rematch adds one)
 */
export function SaveProgressCard({ room, game }) {
  const save = useSaveProgress();
  const location = useLocation();
  const headingId = useId();
  const { progress, streaks } = save;
  const here = { code: room.code, game };
  const shown =
    save.guest &&
    progress !== undefined &&
    outcomeFor(room) === "win" &&
    winWorthSaving(progress) &&
    !save.isDismissed(PROMPTS.ROOM_CARD) &&
    save.mayOfferInRoom(here);
  const { offeredInRoom } = save;

  useEffect(() => {
    if (shown) offeredInRoom({ code: room.code, game });
  }, [shown, offeredInRoom, room.code, game]);

  if (!shown) {
    return null;
  }
  const next = returnPathFor(location);
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.top}>
        <h2 id={headingId} className={styles.heading}>
          Save your progress
        </h2>
        <DismissButton label="Close: save your progress" onClick={() => save.dismiss(PROMPTS.ROOM_CARD)} />
      </div>
      <p className={styles.lead}>You're playing as a guest. Sign up and keep everything you've earned:</p>
      <ul className={styles.stats} aria-label="What you'd keep">
        <li className={styles.stat}>
          <LevelBadge level={progress.level} size="sm" decorative />
          Level {progress.level}
        </li>
        <li className={`${styles.stat} ${styles.xp}`}>{progress.xp} XP</li>
        <li className={styles.stat}>{plural(progress.wins, "win", "wins")}</li>
        {streaks !== undefined && (
          <li className={styles.stat}>
            <span aria-hidden="true">
              <StreakFlame count={streaks.daily.current} className={styles.flame} />
            </span>
            {streaks.daily.current}-day streak
          </li>
        )}
      </ul>
      <div className={styles.actions}>
        <Link to={paths.signup(next)} className={styles.primary}>
          Sign up — keep it
        </Link>
        <Link to={paths.login(next)} className={styles.secondary}>
          Log in
        </Link>
      </div>
    </section>
  );
}
