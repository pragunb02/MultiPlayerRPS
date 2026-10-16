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
}
