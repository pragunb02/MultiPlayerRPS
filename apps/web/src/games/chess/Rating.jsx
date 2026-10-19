import { changeText, ratingText, spokenRating } from "./ratingText.js";
import styles from "./ChessBoard.module.css";

/**
 * A player's chess rating in their match bar (CC-042). A small slot of its own, so the match bar and the coming
 * outcome screen (CC-163) can place it where they like.
 *
 * @param {{ rating: { rating: number, provisional: boolean } }} props
 */
export function RatingBadge({ rating }) {
  return (
    <span className={styles.rating} role="img" aria-label={spokenRating(rating)}>
      {ratingText(rating)}
    </span>
  );
}

/**
 * What the game did to each player's rating, for the result panel (CC-042): the new rating and its change, and
 * "Provisional" during the first 10 rated games. Only the players whose rating the game changed are listed, so a
 * game that was not rated shows nothing.
 *
 * @param {{ players: ReadonlyArray<{ name: string, rating: { rating: number, provisional: boolean, change?: number } }> }} props
 *   `name`: "You" or the player's display name
 */
export function RatingChanges({ players }) {
  const changed = players.filter(({ rating }) => rating.change !== undefined);
  if (changed.length === 0) {
    return null;
  }
  return (
    <ul className={styles.ratingChanges} aria-label="Rating changes">
      {changed.map(({ name, rating }) => (
        <li key={name}>
          <span className={styles.ratingName}>{name}</span>
          <span className={styles.ratingNew}>{rating.rating}</span>
          <span className={rating.change < 0 ? styles.ratingDown : styles.ratingUp}>
            {changeText(rating.change)}
          </span>
          {rating.provisional && <span className={styles.ratingProvisional}>Provisional</span>}
        </li>
      ))}
    </ul>
  );
}
