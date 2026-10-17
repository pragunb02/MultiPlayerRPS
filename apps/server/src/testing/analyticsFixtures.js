/**
 * Builds stored documents for owner console tests (CC-233), shaped exactly like the ones the DAOs write, so a test
 * can put a known history straight into MongoDB and check every total against it.
 */

let matchNumber = 0;

/**
 * A finished match as `matches` stores it.
 *
 * @param {{
 *   gameId?: string,
 *   roomCode?: string,
 *   playerIds: string[],
 *   endedAt: string | Date,
 *   seconds?: number,
 *   notCounted?: Array<{ playerId: string, reason: string }>,
 *   judged?: boolean,
 * }} fields  `seconds` is how long it took (60 unless given)
 */
export function matchDoc({
  gameId = "rps",
  roomCode,
  playerIds,
  endedAt,
  seconds = 60,
  notCounted = [],
  judged = true,
}) {
  const end = new Date(endedAt);
  matchNumber += 1;
  return {
    matchId: `m-${matchNumber}`,
    roomCode: roomCode ?? `R${String(matchNumber).padStart(5, "0")}`,
    gameId,
    options: {},
    seed: 1,
    players: playerIds.map((playerId, index) => ({ playerId, displayName: `Player-${index + 1}` })),
    log: [],
    result: { result: "win", winners: [playerIds[0]], reason: "completed" },
    startedAt: new Date(end.getTime() - seconds * 1000),
    endedAt: end,
    schemaVersion: 1,
    ...(judged && { credit: { notCounted } }),
  };
}

/**
 * A player id of a kind, numbered so a test can make many distinct ones.
 *
 * @param {"guest" | "user" | "bot"} kind
 * @param {number} number
 */
export function playerId(kind, number) {
  if (kind === "guest") {
    return `guest_00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  }
  return kind === "user" ? `user_${String(number).padStart(24, "0")}` : `bot_rocky_${number}`;
}

/**
 * A guest transfer as `player_transfers` stores it.
 *
 * @param {{ number: number, createdAt: string | Date, matches?: number, done?: boolean }} fields
 */
export function transferDoc({ number, createdAt, matches = 1, done = true }) {
  return {
    from: playerId("guest", 900_000 + number),
    to: { kind: "user", id: playerId("user", 900_000 + number), displayName: `Saver-${number}` },
    status: done ? "done" : "pending",
    createdAt: new Date(createdAt),
    ...(done && {
      completedAt: new Date(createdAt),
      carriedOver: { xp: 10, matchesPlayed: matches, matches },
    }),
  };
}
