import { expect, it } from "vitest";
import { DuplicateKey } from "../persistence/errors.js";

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);

/** A persistence-level match document for tests. */
export function matchDoc(overrides = {}) {
  return {
    matchId: "00000000-0000-4000-8000-000000000001",
    roomCode: "ROOM22",
    gameId: "rps",
    options: { bestOf: 1 },
    seed: 7,
    players: [
      { playerId: "guest_a", displayName: "Alice" },
      { playerId: "guest_b", displayName: "Bob" },
    ],
    log: [
      { kind: "move", playerId: "guest_a", move: { choice: "rock" }, at: T0 },
      { kind: "move", playerId: "guest_b", move: { choice: "paper" }, at: T0 + 1 },
    ],
    result: { result: "win", winners: ["guest_b"], reason: "best-of-1" },
    startedAt: new Date(T0),
    endedAt: new Date(T0 + 1),
    ...overrides,
  };
}

/**
 * The behaviour every match DAO must have. Run against the MongoDB DAO (integration) and the in-memory
 * test double, so the double can never drift from the real thing.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/matchDao.js").createMatchDao>>} createDao
 */
export function runMatchDaoContract(createDao) {
  it("stores a match and reads it back unchanged", async () => {
    const dao = await createDao();

    const stored = await dao.insert(matchDoc());

    expect(stored).toEqual({ ...matchDoc(), schemaVersion: 1 });
    expect(await dao.getByMatchId(matchDoc().matchId)).toEqual(stored);
  });

  it("refuses to record the same match twice", async () => {
    const dao = await createDao();
    await dao.insert(matchDoc());

    await expect(dao.insert(matchDoc())).rejects.toThrow(DuplicateKey);
  });

  it("throws for an unknown match id", async () => {
    const dao = await createDao();

    await expect(dao.getByMatchId("00000000-0000-4000-8000-000000000999")).rejects.toThrow(RangeError);
  });

  it("lists a player's matches newest first, paginated by end time", async () => {
    const dao = await createDao();
    for (let i = 1; i <= 5; i++) {
      await dao.insert(
        matchDoc({ matchId: `00000000-0000-4000-8000-00000000000${i}`, endedAt: new Date(T0 + i * 1000) }),
      );
    }
    await dao.insert(
      matchDoc({
        matchId: "00000000-0000-4000-8000-000000000009",
        players: [
          { playerId: "guest_x", displayName: "X" },
          { playerId: "guest_y", displayName: "Y" },
        ],
      }),
    );

    const firstPage = await dao.listByPlayer("guest_a", { limit: 2 });
    const secondPage = await dao.listByPlayer("guest_a", { limit: 2, before: firstPage.at(-1).endedAt });

    expect(firstPage.map((m) => m.matchId.at(-1))).toEqual(["5", "4"]);
    expect(secondPage.map((m) => m.matchId.at(-1))).toEqual(["3", "2"]);
    expect(await dao.listByPlayer("guest_nobody", { limit: 10 })).toEqual([]);
  });

  it("counts a player's wins of one game", async () => {
    const dao = await createDao();
    const won = (n, gameId, winners) =>
      matchDoc({
        matchId: `00000000-0000-4000-8000-00000000010${n}`,
        gameId,
        result: { ...matchDoc().result, winners },
      });
    await dao.insert(won(1, "rps", ["guest_b"]));
    await dao.insert(won(2, "rps", ["guest_b"]));
    await dao.insert(won(3, "rps", ["guest_a"]));
    await dao.insert(won(4, "chess", ["guest_b"]));
    await dao.insert(won(5, "rps", []));

    expect(await dao.countWins({ playerId: "guest_b", gameId: "rps" })).toBe(2);
    expect(await dao.countWins({ playerId: "guest_b", gameId: "chess" })).toBe(1);
    expect(await dao.countWins({ playerId: "guest_a", gameId: "chess" })).toBe(0);
    expect(await dao.countWins({ playerId: "guest_nobody", gameId: "rps" })).toBe(0);
  });

  it("returns copies that cannot change what is stored", async () => {
    const dao = await createDao();
    const stored = await dao.insert(matchDoc());

    stored.players[0].displayName = "Mallory";

    expect((await dao.getByMatchId(matchDoc().matchId)).players[0].displayName).toBe("Alice");
  });

  it("lists a guest's matches without those against a given player, oldest first", async () => {
    const dao = await createDao();
    const vs = (opponent) => [
      { playerId: "guest_a", displayName: "Alice" },
      { playerId: opponent, displayName: "Other" },
    ];
    await dao.insert(matchDoc({ matchId: "m-late", players: vs("guest_b"), endedAt: new Date(T0 + 2000) }));
    await dao.insert(matchDoc({ matchId: "m-early", players: vs("guest_c"), endedAt: new Date(T0 + 1000) }));
    await dao.insert(matchDoc({ matchId: "m-vs-account", players: vs("user_1") }));

    const listed = await dao.listByPlayerExcluding("guest_a", { excluding: "user_1" });

    expect(listed.map((m) => m.matchId)).toEqual(["m-early", "m-late"]);
    expect(await dao.listByPlayerExcluding("guest_nobody", { excluding: "user_1" })).toEqual([]);
  });

  it("replaces a match with its renamed copy only while the old player is still in it", async () => {
    const dao = await createDao();
    await dao.insert(matchDoc());
    const renamed = matchDoc({
      players: [
        { playerId: "user_1", displayName: "Riya" },
        { playerId: "guest_b", displayName: "Bob" },
      ],
    });

    const first = await dao.renamePlayer({ matchId: matchDoc().matchId, from: "guest_a", doc: renamed });
    const again = await dao.renamePlayer({ matchId: matchDoc().matchId, from: "guest_a", doc: matchDoc() });
    const unknown = await dao.renamePlayer({ matchId: "m-none", from: "guest_a", doc: renamed });

    expect([first, again, unknown]).toEqual([true, false, false]);
    expect(await dao.getByMatchId(matchDoc().matchId)).toEqual({ ...renamed, schemaVersion: 1 });
    expect(await dao.listByPlayer("guest_a", { limit: 10 })).toEqual([]);
    expect(await dao.listByPlayer("user_1", { limit: 10 })).toHaveLength(1);
  });

  it("stores how a match counts once: the first verdict stays", async () => {
    const dao = await createDao();
    await dao.insert(matchDoc());
    const first = { notCounted: [{ playerId: "guest_a", reason: "ended-too-soon" }] };

    const judged = await dao.judgeOnce({ matchId: matchDoc().matchId, credit: first });
    const again = await dao.judgeOnce({ matchId: matchDoc().matchId, credit: { notCounted: [] } });

    expect(judged).toEqual({ ...matchDoc(), schemaVersion: 1, credit: first });
    expect(again.credit).toEqual(first);
    await expect(dao.judgeOnce({ matchId: "m-none", credit: first })).rejects.toThrow(RangeError);
  });

  it("keeps a verdict through a rename", async () => {
    const dao = await createDao();
    await dao.insert(matchDoc());
    const credit = { notCounted: [{ playerId: "user_1", reason: "hourly-limit", withdrawnFrom: "guest_a" }] };
    const renamed = matchDoc({
      players: [{ playerId: "user_1", displayName: "Riya" }, matchDoc().players[1]],
    });

    await dao.renamePlayer({ matchId: matchDoc().matchId, from: "guest_a", doc: { ...renamed, credit } });

    expect((await dao.getByMatchId(matchDoc().matchId)).credit).toEqual(credit);
  });

  it("counts only the wins that count for the winner", async () => {
    const dao = await createDao();
    const won = (n) => matchDoc({ matchId: `m-win-${n}` });
    await dao.insert(won(1));
    await dao.insert(won(2));
    await dao.insert(won(3));
    await dao.judgeOnce({
      matchId: "m-win-2",
      credit: { notCounted: [{ playerId: "guest_b", reason: "ended-too-soon" }] },
    });
    await dao.judgeOnce({
      matchId: "m-win-3",
      credit: { notCounted: [{ playerId: "guest_a", reason: "hourly-limit" }] },
    });

    expect(await dao.countWins({ playerId: "guest_b", gameId: "rps" })).toBe(2);
  });

  it("leaves wins against a computer character out of the count of wins (ADR-025)", async () => {
    const dao = await createDao();
    const vsRocky = [
      { playerId: "guest_b", displayName: "Bob" },
      { playerId: "bot_rocky_easy", displayName: "Rocky" },
    ];
    await dao.insert(matchDoc({ matchId: "m-person" }));
    await dao.insert(matchDoc({ matchId: "m-computer", players: vsRocky }));

    expect(await dao.countWins({ playerId: "guest_b", gameId: "rps" })).toBe(1);
  });

  it("lists a player's games that count in a time window, without one match, oldest first", async () => {
    const dao = await createDao();
    const at = (n, overrides = {}) =>
      matchDoc({ matchId: `m-${n}`, endedAt: new Date(T0 + n * 1000), ...overrides });
    await dao.insert(at(0));
    await dao.insert(at(2));
    await dao.insert(at(1));
    await dao.insert(at(3));
    await dao.insert(at(4));
    await dao.insert(at(5, { players: [{ playerId: "guest_x", displayName: "X" }, matchDoc().players[1]] }));
    await dao.insert(at(6));
    await dao.judgeOnce({
      matchId: "m-3",
      credit: { notCounted: [{ playerId: "guest_a", reason: "ended-too-soon" }] },
    });
    await dao.judgeOnce({ matchId: "m-4", credit: { notCounted: [] } });

    const listed = await dao.listCountedBetween("guest_a", {
      from: new Date(T0 + 1000),
      to: new Date(T0 + 6000),
      excluding: "m-2",
    });

    expect(listed).toEqual([
      { matchId: "m-1", players: matchDoc().players, endedAt: new Date(T0 + 1000) },
      {
        matchId: "m-4",
        players: matchDoc().players,
        endedAt: new Date(T0 + 4000),
        credit: { notCounted: [] },
      },
    ]);
  });

  it("lists the games that stopped counting when a guest's games moved to a player", async () => {
    const dao = await createDao();
    const withdrawn = (playerId, from) => ({
      notCounted: [{ playerId, reason: "opponent-daily-limit", withdrawnFrom: from }],
    });
    const user = [{ playerId: "user_1", displayName: "Riya" }, matchDoc().players[1]];
    await dao.insert(matchDoc({ matchId: "m-late", players: user, endedAt: new Date(T0 + 2000) }));
    await dao.insert(matchDoc({ matchId: "m-early", players: user, endedAt: new Date(T0 + 1000) }));
    await dao.insert(matchDoc({ matchId: "m-other-guest", players: user }));
    await dao.insert(matchDoc({ matchId: "m-own-limit", players: user }));
    await dao.insert(matchDoc({ matchId: "m-counted", players: user }));
    await dao.judgeOnce({ matchId: "m-late", credit: withdrawn("user_1", "guest_a") });
    await dao.judgeOnce({ matchId: "m-early", credit: withdrawn("user_1", "guest_a") });
    await dao.judgeOnce({ matchId: "m-other-guest", credit: withdrawn("user_1", "guest_c") });
    await dao.judgeOnce({
      matchId: "m-own-limit",
      credit: { notCounted: [{ playerId: "user_1", reason: "hourly-limit" }] },
    });

    const listed = await dao.listWithdrawn({ playerId: "user_1", from: "guest_a" });

    expect(listed.map((m) => m.matchId)).toEqual(["m-early", "m-late"]);
    expect(listed[0]).toEqual(
      expect.objectContaining({ players: user, credit: withdrawn("user_1", "guest_a") }),
    );
  });

  it("also lists the games against a computer character that give a player less XP than they gave the guest", async () => {
    const dao = await createDao();
    const user = [
      { playerId: "user_1", displayName: "Riya" },
      { playerId: "bot_rocky_easy", displayName: "Rocky" },
    ];
    const botXp = (entry) => ({ notCounted: [], botXp: [{ playerId: "user_1", xp: 10, left: 0, ...entry }] });
    await dao.insert(matchDoc({ matchId: "m-capped", players: user }));
    await dao.insert(matchDoc({ matchId: "m-other-guest", players: user }));
    await dao.insert(matchDoc({ matchId: "m-full", players: user }));
    await dao.judgeOnce({
      matchId: "m-capped",
      credit: botXp({ withdrawnFrom: "guest_a", withdrawnXp: 20 }),
    });
    await dao.judgeOnce({
      matchId: "m-other-guest",
      credit: botXp({ withdrawnFrom: "guest_c", withdrawnXp: 20 }),
    });
    await dao.judgeOnce({ matchId: "m-full", credit: botXp({}) });

    const listed = await dao.listWithdrawn({ playerId: "user_1", from: "guest_a" });

    expect(listed.map((m) => m.matchId)).toEqual(["m-capped"]);
    expect(listed[0].credit).toEqual(botXp({ withdrawnFrom: "guest_a", withdrawnXp: 20 }));
  });

  it("deletes a match only while the player is still in it (CC-035)", async () => {
    const dao = await createDao();
    await dao.insert(matchDoc());

    expect(await dao.deleteForPlayer({ matchId: matchDoc().matchId, playerId: "guest_c" })).toBe(false);
    expect(await dao.deleteForPlayer({ matchId: matchDoc().matchId, playerId: "guest_a" })).toBe(true);
    expect(await dao.deleteForPlayer({ matchId: matchDoc().matchId, playerId: "guest_a" })).toBe(false);

    await expect(dao.getByMatchId(matchDoc().matchId)).rejects.toThrow(RangeError);
  });

  it("pages a player's matches newest first on end time and id, so a tie at a page edge loses none (CC-035)", async () => {
    const dao = await createDao();
    const same = new Date(T0 + 5000);
    for (const n of [1, 2, 3, 4]) {
      await dao.insert(matchDoc({ matchId: `m-${n}`, endedAt: n === 1 ? new Date(T0) : same }));
    }

    const first = await dao.listPageByPlayer("guest_a", { limit: 2 });
    const last = first.at(-1);
    const second = await dao.listPageByPlayer("guest_a", {
      limit: 2,
      after: { endedAt: last.endedAt, matchId: last.matchId },
    });
    const third = await dao.listPageByPlayer("guest_a", {
      limit: 2,
      after: { endedAt: second.at(-1).endedAt, matchId: second.at(-1).matchId },
    });

    expect(first.map((m) => m.matchId)).toEqual(["m-4", "m-3"]);
    expect(second.map((m) => m.matchId)).toEqual(["m-2", "m-1"]);
    expect(third).toEqual([]);
    expect(await dao.listPageByPlayer("guest_nobody", { limit: 2 })).toEqual([]);
  });

  it("renames a match not judged yet only while it is still not judged (CC-035)", async () => {
    const dao = await createDao();
    await dao.insert(matchDoc());
    const renamed = {
      ...matchDoc(),
      players: [{ playerId: "deleted_1", displayName: "Deleted player" }, matchDoc().players[1]],
    };
    await dao.judgeOnce({ matchId: matchDoc().matchId, credit: { notCounted: [] } });

    expect(
      await dao.renamePlayer({ matchId: matchDoc().matchId, from: "guest_a", doc: renamed, unjudged: true }),
    ).toBe(false);
    expect(await dao.renamePlayer({ matchId: matchDoc().matchId, from: "guest_a", doc: renamed })).toBe(true);
  });
}
