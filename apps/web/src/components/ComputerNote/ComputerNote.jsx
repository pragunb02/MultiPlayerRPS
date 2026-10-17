import { BOT_DAILY_XP } from "@classicade/shared";
import { computerSeats } from "../computer.js";
import styles from "./ComputerNote.module.css";

/**
 * In a game against a computer character: who the computer is, and how the game counts (ADR-025). Nothing in a
 * game between people.
 *
 * @param {{ room: { seats: Array<{ displayName: string, bot?: object }> } }} props
 */
export function ComputerNote({ room }) {
  const [computer] = computerSeats(room);
  if (computer === undefined) {
    return null;
  }
  return (
    <p className={styles.note}>
      {computer.displayName} is a computer player. This game counts for your quests and gives XP, up to{" "}
      {BOT_DAILY_XP} XP a day from computer games. It never counts on leaderboards.
    </p>
  );
}
