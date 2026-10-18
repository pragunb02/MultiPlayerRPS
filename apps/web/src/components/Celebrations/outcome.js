/**
 * How a finished game went for the viewer: "win", "loss", "draw", or "watched" for a spectator.
 *
 * @param {{ you: string, game: { outcome: { result: string, winners: string[] } } }} room
 * @returns {"win" | "loss" | "draw" | "watched"}
 */
export function outcomeFor(room) {
  const { outcome } = room.game;
  // An aborted game has no winner and counts for nothing, so it looks as calm as a draw (CC-036).
  if (outcome.result === "draw" || outcome.result === "aborted") {
    return "draw";
  }
  if (room.you === "") {
    return "watched";
  }
  return outcome.winners.includes(room.you) ? "win" : "loss";
}
