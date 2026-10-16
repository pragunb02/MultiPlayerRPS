/**
 * How a finished game went for the viewer: "win", "loss", "draw", or "watched" for a spectator.
 *
 * @param {{ you: string, game: { outcome: { result: string, winners: string[] } } }} room
 * @returns {"win" | "loss" | "draw" | "watched"}
 */
export function outcomeFor(room) {
  const { outcome } = room.game;
  if (outcome.result === "draw") {
    return "draw";
  }
  if (room.you === "") {
    return "watched";
  }
  return outcome.winners.includes(room.you) ? "win" : "loss";
}
