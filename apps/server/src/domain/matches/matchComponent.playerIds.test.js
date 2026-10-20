import { describe, expect, it } from "vitest";
import { createMatchAccessor } from "../../data/matchAccessor.js";
import { createInMemoryMatchDao } from "../../testing/inMemoryMatchDao.js";
import { TEST_MATCH_PLAYER_IDS } from "../../testing/matchPlayerIds.js";
import { NotFoundError } from "../../utils/errors.js";
import { createMatchComponent } from "./matchComponent.js";

// CC-297: match history names every player by an id made for that match, never by their player id.
const T0 = Date.UTC(2025, 9, 9, 9);
const MATCH_ID = "00000000-0000-4000-8000-000000000001";
const ALICE = "user_65f1a2b3c4d5e6f708192a3b";
const BOB = "guest_00000000-0000-4000-8000-0000000000b0";
const ACCOUNT = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Bob" });
const seat = (playerId, displayName) => ({ playerId, displayName, connected: true });
const room = ({ matchId = MATCH_ID, seats = [seat(ALICE, "Alice"), seat(BOB, "Bob")], log } = {}) => ({
  code: "ROOM22",
  gameId: "rps",
  options: { bestOf: 1 },
  status: "finished",
  hostId: seats[0].playerId,
  seats,
  game: {
    matchId,
    seed: 7,
    startedAt: T0,
    state: {},
    log: log ?? [
      { kind: "move", playerId: ALICE, move: { choice: "rock" }, at: T0 + 1 },
      { kind: "agree", type: "draw", from: BOB, playerId: ALICE, at: T0 + 2 },
      { kind: "idle", playerIds: [BOB], at: T0 + 3 },
      { kind: "forfeit", playerId: BOB, at: T0 + 4 },
      // A kind of entry that names a player as a key, as a later game might.
      { kind: "score", byPlayer: { [ALICE]: 1, [BOB]: 0 }, at: T0 + 5 },
    ],
  },
  createdAt: T0 - 1_000,
  lastActivityAt: T0 + 9_000,
  finishedAt: T0 + 9_000,
});
const aliceWins = (playerId = ALICE) => ({
  status: "finished",
  result: "win",
  winners: [playerId],
  reason: "forfeit",
});
const idIn = (matchId, playerId) => TEST_MATCH_PLAYER_IDS.playerIdIn({ matchId }, playerId);
const setup = (overrides = {}) =>
  createMatchComponent({
    matchAccessor: createMatchAccessor({ matchDao: createInMemoryMatchDao() }),
    matchPlayerIds: TEST_MATCH_PLAYER_IDS,
    ...overrides,
  });
const PLAYER_ID = /(guest|user|bot|deleted)_[0-9a-z_-]+/g;

describe("match history names players by match player ids (CC-297)", () => {
  it("lists a match with every player, the viewer too, named by their id for that match, and says which is you", async () => {
    const matches = setup();
    await matches.recordFinished({ room: room(), outcome: aliceWins() });

    const [listed] = await matches.listForPlayer({ playerId: BOB, limit: 10 });

    expect(listed.you).toBe(idIn(MATCH_ID, BOB));
    expect(listed.players).toEqual([
      { playerId: idIn(MATCH_ID, ALICE), displayName: "Alice" },
      { playerId: idIn(MATCH_ID, BOB), displayName: "Bob" },
    ]);
    expect(listed.result.winners).toEqual([idIn(MATCH_ID, ALICE)]);
    expect(listed.outcomeForYou).toBe("loss");
    expect(JSON.stringify(listed).match(PLAYER_ID)).toBeNull();
  });

  it("names every player the same way in the details: players, winners and every log entry, as values and as keys", async () => {
    const matches = setup();
    await matches.recordFinished({ room: room(), outcome: aliceWins() });

    const details = await matches.getForPlayer({ matchId: MATCH_ID, playerId: BOB });

    const [alice, bob] = [idIn(MATCH_ID, ALICE), idIn(MATCH_ID, BOB)];
    expect(details.you).toBe(bob);
    expect(details.players.map((p) => p.playerId)).toEqual([alice, bob]);
    expect(details.result.winners).toEqual([alice]);
    expect(details.log).toEqual([
      { kind: "move", playerId: alice, move: { choice: "rock" }, at: T0 + 1 },
      { kind: "agree", type: "draw", from: bob, playerId: alice, at: T0 + 2 },
      { kind: "idle", playerIds: [bob], at: T0 + 3 },
      { kind: "forfeit", playerId: bob, at: T0 + 4 },
      { kind: "score", byPlayer: { [alice]: 1, [bob]: 0 }, at: T0 + 5 },
    ]);
    expect(details.seed).toBe(7);
    expect(JSON.stringify(details).match(PLAYER_ID)).toBeNull();
  });

  it("shows both players the same ids for a match, so their copies agree", async () => {
    const matches = setup();
    await matches.recordFinished({ room: room(), outcome: aliceWins() });

    const forAlice = await matches.getForPlayer({ matchId: MATCH_ID, playerId: ALICE });
    const forBob = await matches.getForPlayer({ matchId: MATCH_ID, playerId: BOB });

    expect(forAlice.players).toEqual(forBob.players);
    expect(forAlice.you).not.toBe(forBob.you);
  });

  it("gives the same opponent an unrelated id in every other match, so matches cannot be linked by it", async () => {
    const matches = setup();
    const second = "00000000-0000-4000-8000-000000000002";
    await matches.recordFinished({ room: room(), outcome: aliceWins() });
    await matches.recordFinished({ room: room({ matchId: second }), outcome: aliceWins() });

    const listed = await matches.listForPlayer({ playerId: BOB, limit: 10 });

    const opponents = listed.map((match) => match.players.find((p) => p.playerId !== match.you).playerId);
    expect(new Set(opponents).size).toBe(2);
  });

  it("names a guest opponent who signed in since by a match id, never by their account's id", async () => {
    const matches = setup();
    await matches.recordFinished({ room: room(), outcome: aliceWins() });
    await matches.transferPlayer({ from: BOB, to: ACCOUNT, now: T0 });

    const [listed] = await matches.listForPlayer({ playerId: ALICE, limit: 10 });
    const details = await matches.getForPlayer({ matchId: MATCH_ID, playerId: ALICE });

    expect(listed.players[1]).toEqual({ playerId: idIn(MATCH_ID, ACCOUNT.id), displayName: "Bob" });
    expect(JSON.stringify([listed, details])).not.toContain(ACCOUNT.id);
    expect(JSON.stringify([listed, details])).not.toContain(BOB);
  });

  it("names a computer character by a match id and still labels it as a computer", async () => {
    const matches = setup();
    const seats = [seat(ALICE, "Alice"), seat("bot_rocky_easy", "Rocky")];
    await matches.recordFinished({ room: room({ seats, log: [] }), outcome: aliceWins() });

    const [listed] = await matches.listForPlayer({ playerId: ALICE, limit: 10 });

    expect(listed.players[1]).toEqual({
      playerId: idIn(MATCH_ID, "bot_rocky_easy"),
      displayName: "Rocky",
      computer: true,
    });
  });

  it("names a deleted player's stand-in by a match id, without its stand-in id", async () => {
    const matches = setup({ newUuid: () => "00000000-0000-4000-8000-0000000000d0" });
    await matches.recordFinished({ room: room(), outcome: aliceWins() });
    await matches.erasePlayer({ playerId: ALICE });

    const details = await matches.getForPlayer({ matchId: MATCH_ID, playerId: BOB });

    expect(details.players[0].displayName).toBe("Deleted player");
    expect(JSON.stringify(details).match(PLAYER_ID)).toBeNull();
  });

  it("names a player who appears only in the log, so no id can slip past the players list", async () => {
    const matches = setup();
    const log = [{ kind: "forfeit", playerId: "guest_00000000-0000-4000-8000-0000000000c0", at: T0 + 1 }];
    await matches.recordFinished({ room: room({ log }), outcome: aliceWins() });

    const details = await matches.getForPlayer({ matchId: MATCH_ID, playerId: BOB });

    expect(JSON.stringify(details).match(PLAYER_ID)).toBeNull();
  });

  it("leaves the stored match as it was: nothing is written, so nothing is migrated", async () => {
    const matches = setup();
    await matches.recordFinished({ room: room(), outcome: aliceWins() });
    await matches.getForPlayer({ matchId: MATCH_ID, playerId: BOB });

    const stored = await matches.getById(MATCH_ID);

    expect(stored.players.map((p) => p.playerId)).toEqual([ALICE, BOB]);
  });

  it("gives the server the real players of a match, for its participants only", async () => {
    const matches = setup();
    await matches.recordFinished({ room: room(), outcome: aliceWins() });

    const players = await matches.playersFor({ matchId: MATCH_ID, playerId: BOB });

    expect(players).toEqual([
      { playerId: ALICE, displayName: "Alice" },
      { playerId: BOB, displayName: "Bob" },
    ]);
    await expect(matches.playersFor({ matchId: MATCH_ID, playerId: "guest_x" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("has no default match player ids, so a view can never fall back to player ids", () => {
    expect(() => setup({ matchPlayerIds: undefined })).toThrow(TypeError);
  });
});
