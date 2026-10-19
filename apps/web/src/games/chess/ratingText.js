/**
 * A rating as it is written: "1500?" while it is provisional, as on Lichess and in ADR-027, and "1612" after.
 *
 * @param {{ rating: number, provisional: boolean }} rating
 */
export const ratingText = ({ rating, provisional }) => `${rating}${provisional ? "?" : ""}`;

/**
 * What a screen reader says for a rating: "Rating 1500, provisional".
 *
 * @param {{ rating: number, provisional: boolean }} rating
 */
export const spokenRating = ({ rating, provisional }) =>
  `Rating ${rating}${provisional ? ", provisional" : ""}`;

/**
 * A change in rating with its sign: "+12", "−8" (a real minus sign) or "±0".
 *
 * @param {number} change
 */
export function changeText(change) {
  if (change === 0) return "±0";
  return change > 0 ? `+${change}` : `−${Math.abs(change)}`;
}
