import { describe, expect, it } from "vitest";
import { GAME_IDS, QUICK_MATCH_OUTCOMES } from "@classicade/shared";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { botRooms, NETWORK } from "../../testing/botRooms.js";
import { captureLogger } from "../../testing/captureLogger.js";
import { ConflictError } from "../../utils/errors.js";
import { agePolicyFor, AUDIENCES, QUICK_MATCH_MODES } from "../safety/agePolicy.js";
import { createMatchmakingComponent } from "./matchmakingComponent.js";
import { MATCHMAKING_RULES } from "./matchmakingRules.js";
import { COUNT_OUTCOMES, createQuickMatchCounts } from "./quickMatchCounts.js";

const RIYA = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-00000000000a",
  displayName: "Riya",
});
const ARJUN = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-00000000000b",
  displayName: "Arjun",
});
const MEERA = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-00000000000c",
  displayName: "Meera",
});
const KABIR = Object.freeze({ kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c1", displayName: "Kabir" });
const START = Date.parse("2026-10-21T14:00:00.000Z");
const SEARCH_MS = MATCHMAKING_RULES.searchMs;

/** Lets every promise that can settle now settle, the in-memory room store's included. */
async function settled() {
  for (let round = 0; round < 20; round++) await new Promise((resolve) => setImmediate(resolve));
}

/** A clock and timers the test moves by hand, so the search time is exact and nothing waits for real. */
function manualTime() {
  let at = START;
  const timers = new Set();
  return {
    now: () => at,
    timers: {
      set: (run, ms) => {
        const timer = { due: at + ms, run };
        timers.add(timer);
        return timer;
      },
      clear: (timer) => timers.delete(timer),
    },
    pending: () => timers.size,
    async advance(ms) {
      const until = at + ms;
      for (;;) {
        const next = [...timers].filter((timer) => timer.due <= until).sort((a, b) => a.due - b.due)[0];
        if (next === undefined) break;
        timers.delete(next);
        at = Math.max(at, next.due);
        next.run();
        await settled();
      }
      at = until;
      await settled();
    },
  };
}

/**
 * The matchmaker over the real room component, engines and characters. Blocks are a list the test changes,
 * `blockedAfter` makes the block show only from that read of the block list on (to hit a race), ratings are given
 * per player, and every player is an adult unless `policies` says otherwise.
 */
function setup({
  blockedPairs = [],
  blockedAfter = 0,
  ratings = {},
  policies = {},
  rules,
  wrapRooms = (rooms) => rooms,
} = {}) {
  const time = manualTime();
  let blockReads = 0;
  const blocks = {
    async blockedWith({ playerId }) {
      blockReads += 1;
      if (blockReads <= blockedAfter) return new Set();
      return new Set(blockedPairs.flatMap(([a, b]) => (a === playerId ? [b] : b === playerId ? [a] : [])));
    },
    async relationsOf({ playerId }) {
      return {
        blocked: new Set(blockedPairs.filter(([a]) => a === playerId).map(([, b]) => b)),
        blockedBy: new Set(blockedPairs.filter(([, b]) => b === playerId).map(([a]) => a)),
      };
    },
  };
  const world = botRooms({ blocks });
  const counts = createQuickMatchCounts({ now: time.now });
  const capture = captureLogger();
  const matchmaking = createMatchmakingComponent({
    rooms: wrapRooms(world.rooms),
    bots: world.botComponent,
    blocks,
    safety: { policyFor: async ({ playerId }) => policies[playerId] ?? agePolicyFor(AUDIENCES.ADULT) },
    ratings: {
      ratingsOf: async ({ playerIds }) =>
        playerIds.filter((id) => ratings[id] !== undefined).map((id) => ({ rating: ratings[id] })),
    },
    counts,
    now: time.now,
    logger: capture.logger,
    timers: time.timers,
    ...(rules && { rules: { ...MATCHMAKING_RULES, ...rules } }),
  });
  /** Starts a search and keeps every outcome it gets, so a test can check there is exactly one. */
  function search(
    player,
    { gameId = GAME_IDS.RPS, othersOnline = 5, socketId = `socket-${player.id}` } = {},
  ) {
    const outcomes = [];
    const done = matchmaking
      .search({ player, network: NETWORK, gameId, level: "easy", othersOnline, socketId })
      .then(
        (result) => {
          outcomes.push(result);
          return result;
        },
        (err) => {
          outcomes.push(err);
          return err;
        },
      );
    return { done, outcomes };
  }
  return { ...world, time, matchmaking, search, counts, blocks };
}

const seated = (room) => room.seats.map((seat) => seat.playerId);
const isComputer = (room) => room.seats.some((seat) => seat.bot !== undefined);

describe("matchmakingComponent (CC-051)", () => {
  it("pairs two players searching the same game into one started game, the one who waited longer hosting it", async () => {
    const { search, time, roomAccessor } = setup();

    const riya = search(RIYA);
    await settled();
    await time.advance(1_000);
    const arjun = search(ARJUN);
    const [forRiya, forArjun] = await Promise.all([riya.done, arjun.done]);

    expect(forRiya.outcome).toBe(QUICK_MATCH_OUTCOMES.PERSON);
    expect(forArjun.outcome).toBe(QUICK_MATCH_OUTCOMES.PERSON);
    expect(forRiya.room.code).toBe(forArjun.room.code);
    expect(forRiya.room.status).toBe("playing");
    expect(forRiya.room.hostId).toBe(RIYA.id);
    expect(seated(forRiya.room)).toEqual([RIYA.id, ARJUN.id]);
    expect(isComputer(forRiya.room)).toBe(false);
    // The room is marked: whoever sits with the host met as strangers (ADR-051.7).
    expect(forRiya.room.quickMatch).toBe(true);
    await settled();
    // Arjun's own room, made ready for his character, is closed.
    expect((await roomAccessor.listAll()).map((room) => room.code)).toEqual([forRiya.room.code]);
  });

  it("race: two players searching at once get one game together, each exactly one outcome", async () => {
    const { search, time, roomAccessor } = setup();

    const riya = search(RIYA);
    const arjun = search(ARJUN);
    await settled();
    await time.advance(SEARCH_MS * 2);

    expect(riya.outcomes).toHaveLength(1);
    expect(arjun.outcomes).toHaveLength(1);
    expect(riya.outcomes[0].outcome).toBe(QUICK_MATCH_OUTCOMES.PERSON);
    expect(arjun.outcomes[0].room.code).toBe(riya.outcomes[0].room.code);
    const open = await roomAccessor.listAll();
    expect(open).toHaveLength(1);
    expect(isComputer(open[0])).toBe(false);
  });

  it("race: three players at once make one pair, and the third plays the character, never a second pair", async () => {
    const { search, time, roomAccessor } = setup();

    const searches = [search(RIYA), search(ARJUN), search(MEERA)];
    await settled();
    await time.advance(SEARCH_MS);

    expect(searches.map(({ outcomes }) => outcomes.length)).toEqual([1, 1, 1]);
    expect(searches.map(({ outcomes }) => outcomes[0].outcome)).toEqual([
      QUICK_MATCH_OUTCOMES.PERSON,
      QUICK_MATCH_OUTCOMES.PERSON,
      QUICK_MATCH_OUTCOMES.CHARACTER,
    ]);
    const rooms = await roomAccessor.listAll();
    expect(rooms.map((room) => [seated(room), isComputer(room)])).toEqual([
      [[RIYA.id, ARJUN.id], false],
      [[MEERA.id, "bot_rocky_easy"], true],
    ]);
  });

  it("plays the character in the room made ready at the start, as soon as the search time is up", async () => {
    const { search, time, roomAccessor } = setup();

    const riya = search(RIYA);
    await settled();
    // The room for the character is ready while the search still looks.
    const [ready] = await roomAccessor.listAll();
    expect(ready.status).toBe("waiting");
    await time.advance(SEARCH_MS - 1);
    expect(riya.outcomes).toEqual([]);
    await time.advance(1);

    expect(riya.outcomes).toHaveLength(1);
    expect(riya.outcomes[0].outcome).toBe(QUICK_MATCH_OUTCOMES.CHARACTER);
    expect(riya.outcomes[0].room.code).toBe(ready.code);
    expect(riya.outcomes[0].room.status).toBe("playing");
    expect(seated(riya.outcomes[0].room)).toEqual([RIYA.id, "bot_rocky_easy"]);
  });

  it("skips the search on an empty site: the character starts at once, with no wait", async () => {
    const { search, time } = setup();

    const riya = search(RIYA, { othersOnline: 0 });
    await settled();

    expect(riya.outcomes).toHaveLength(1);
    expect(riya.outcomes[0].outcome).toBe(QUICK_MATCH_OUTCOMES.CHARACTER);
    expect(isComputer(riya.outcomes[0].room)).toBe(true);
    expect(time.pending()).toBe(0);
  });

  it("still pairs on an otherwise empty site when someone is already searching", async () => {
    const { search } = setup();

    const riya = search(RIYA, { othersOnline: 1 });
    await settled();
    const arjun = search(ARJUN, { othersOnline: 0 });
    await settled();

    expect(arjun.outcomes[0].outcome).toBe(QUICK_MATCH_OUTCOMES.PERSON);
    expect(riya.outcomes[0].room.code).toBe(arjun.outcomes[0].room.code);
  });

  it("cancel while searching takes the player out at once: nobody is paired with them and their room closes", async () => {
    const { search, time, matchmaking, roomAccessor } = setup();

    const riya = search(RIYA);
    await settled();
    expect(await matchmaking.cancel({ playerId: RIYA.id })).toEqual({ cancelled: true });
    const arjun = search(ARJUN);
    await settled();
    await time.advance(SEARCH_MS);

    expect(riya.outcomes).toEqual([{ outcome: QUICK_MATCH_OUTCOMES.CANCELLED }]);
    expect(arjun.outcomes[0].outcome).toBe(QUICK_MATCH_OUTCOMES.CHARACTER);
    expect((await roomAccessor.listAll()).flatMap(seated)).toEqual([ARJUN.id, "bot_rocky_easy"]);
  });

  it("race: a cancel during the pairing, before the game starts, wins, and the partner keeps looking", async () => {
    // Riya's room is still being made when Arjun is paired with her, so the pairing waits on it.
    let roomReady = () => {};
    const slowFirstRoom = (rooms) => {
      let calls = 0;
      return {
        ...rooms,
        createRoom: (input) => {
          calls += 1;
          if (calls > 1) return rooms.createRoom(input);
          return new Promise((resolve) => (roomReady = () => resolve(rooms.createRoom(input))));
        },
      };
    };
    const { search, time, matchmaking } = setup({ wrapRooms: slowFirstRoom });

    const riya = search(RIYA);
    await settled();
    const arjun = search(ARJUN);
    await settled();
    const cancel = matchmaking.cancel({ playerId: RIYA.id });
    roomReady();

    expect(await cancel).toEqual({ cancelled: true });
    await time.advance(SEARCH_MS);
    expect(riya.outcomes).toEqual([{ outcome: QUICK_MATCH_OUTCOMES.CANCELLED }]);
    expect(arjun.outcomes.map((result) => result.outcome)).toEqual([QUICK_MATCH_OUTCOMES.CHARACTER]);
  });

  it("race: the search time running out while a pair is being made keeps the pair, one outcome each", async () => {
    let roomReady = () => {};
    const slowFirstRoom = (rooms) => {
      let calls = 0;
      return {
        ...rooms,
        createRoom: (input) => {
          calls += 1;
          if (calls > 1) return rooms.createRoom(input);
          return new Promise((resolve) => (roomReady = () => resolve(rooms.createRoom(input))));
        },
      };
    };
    const { search, time } = setup({ wrapRooms: slowFirstRoom });

    const riya = search(RIYA);
    await settled();
    const arjun = search(ARJUN);
    await settled();
    // Both searches' time runs out while Riya's room is still on its way.
    await time.advance(SEARCH_MS * 2);
    roomReady();
    await settled();

    expect([riya, arjun].map(({ outcomes }) => outcomes.map((result) => result.outcome))).toEqual([
      [QUICK_MATCH_OUTCOMES.PERSON],
      [QUICK_MATCH_OUTCOMES.PERSON],
    ]);
    expect(isComputer(riya.outcomes[0].room)).toBe(false);
  });

  it("race: a cancel after the game started with a person is too late, and both keep their one game", async () => {
    const { search, matchmaking } = setup();

    const riya = search(RIYA);
    await settled();
    const arjun = search(ARJUN);
    await settled();
    const late = await matchmaking.cancel({ playerId: RIYA.id });

    expect(late).toEqual({ cancelled: false });
    expect(riya.outcomes.map((result) => result.outcome)).toEqual([QUICK_MATCH_OUTCOMES.PERSON]);
    expect(arjun.outcomes.map((result) => result.outcome)).toEqual([QUICK_MATCH_OUTCOMES.PERSON]);
  });

  it("only the tab that searched cancels it when it closes", async () => {
    const { search, matchmaking } = setup();

    const riya = search(RIYA, { socketId: "tab-1" });
    await settled();

    expect(await matchmaking.cancel({ playerId: RIYA.id, socketId: "tab-2" })).toEqual({ cancelled: false });
    expect(riya.outcomes).toEqual([]);
    expect(await matchmaking.cancel({ playerId: RIYA.id, socketId: "tab-1" })).toEqual({ cancelled: true });
  });

  it("a newer search of the same player cancels the older, so a player is never paired with themself", async () => {
    const { search, time } = setup();

    const first = search(RIYA, { socketId: "tab-1" });
    await settled();
    const second = search(RIYA, { socketId: "tab-2" });
    await settled();
    await time.advance(SEARCH_MS);

    expect(first.outcomes).toEqual([{ outcome: QUICK_MATCH_OUTCOMES.CANCELLED }]);
    expect(second.outcomes[0].outcome).toBe(QUICK_MATCH_OUTCOMES.CHARACTER);
  });

  it.each([
    ["Riya blocked Arjun", [RIYA.id, ARJUN.id]],
    ["Arjun blocked Riya", [ARJUN.id, RIYA.id]],
  ])("never pairs a blocked pair (%s): both play the character", async (_case, pair) => {
    const { search, time } = setup({ blockedPairs: [pair] });

    const riya = search(RIYA);
    const arjun = search(ARJUN);
    await settled();
    await time.advance(SEARCH_MS);

    expect([riya, arjun].map(({ outcomes }) => outcomes.map((result) => result.outcome))).toEqual([
      [QUICK_MATCH_OUTCOMES.CHARACTER],
      [QUICK_MATCH_OUTCOMES.CHARACTER],
    ]);
  });

  it("race: a block made between the pair just before they sit down keeps them apart, and a third person still meets one", async () => {
    // The two searches read no block. The room reads it as Arjun sits down, and refuses him as full.
    const { search, time } = setup({ blockedPairs: [[RIYA.id, ARJUN.id]], blockedAfter: 2 });

    const riya = search(RIYA);
    await settled();
    const arjun = search(ARJUN);
    await settled();
    expect(riya.outcomes).toEqual([]);
    expect(arjun.outcomes).toEqual([]);
    const meera = search(MEERA);
    await settled();
    await time.advance(SEARCH_MS);

    const outcomes = [riya, arjun, meera].map(({ outcomes: each }) => each.map((result) => result.outcome));
    expect(outcomes.flat().filter((outcome) => outcome === QUICK_MATCH_OUTCOMES.PERSON)).toHaveLength(2);
    expect(outcomes.every((each) => each.length === 1)).toBe(true);
    const together = [riya, arjun].filter(
      ({ outcomes: each }) => each[0].outcome === QUICK_MATCH_OUTCOMES.PERSON,
    );
    expect(together).toHaveLength(1);
    expect(seated(together[0].outcomes[0].room)).toContain(MEERA.id);
  });

  it("a minor is paired only under the safe rules: the room is marked quick match, so nothing can follow from it", async () => {
    const { search } = setup({ policies: { [KABIR.id]: agePolicyFor(AUDIENCES.MINOR) } });

    const kabir = search(KABIR);
    await settled();
    const riya = search(RIYA);
    await settled();

    expect(kabir.outcomes[0].outcome).toBe(QUICK_MATCH_OUTCOMES.PERSON);
    expect(kabir.outcomes[0].room.quickMatch).toBe(true);
    expect(riya.outcomes[0].room.code).toBe(kabir.outcomes[0].room.code);
  });

  it("a player whose age policy says no strangers never enters a search: the character starts at once", async () => {
    const closed = Object.freeze({ ...agePolicyFor(AUDIENCES.MINOR), quickMatch: QUICK_MATCH_MODES.NONE });
    const { search, time } = setup({ policies: { [KABIR.id]: closed } });

    const riya = search(RIYA);
    await settled();
    const kabir = search(KABIR);
    await settled();

    expect(kabir.outcomes[0].outcome).toBe(QUICK_MATCH_OUTCOMES.CHARACTER);
    expect(isComputer(kabir.outcomes[0].room)).toBe(true);
    await time.advance(SEARCH_MS);
    expect(riya.outcomes[0].outcome).toBe(QUICK_MATCH_OUTCOMES.CHARACTER);
  });

  it("chess pairs within the rating window, which widens as the older search waits", async () => {
    const { search, time } = setup({ ratings: { [RIYA.id]: 1500, [ARJUN.id]: 1680 } });

    const riya = search(RIYA, { gameId: GAME_IDS.CHESS });
    await settled();
    const arjun = search(ARJUN, { gameId: GAME_IDS.CHESS });
    await settled();
    // 180 points apart: more than the 100 at the start, so not yet.
    expect(riya.outcomes).toEqual([]);
    // The window reaches 180 after Riya waited 1.6 s, and the next look pairs them.
    await time.advance(1_600 + MATCHMAKING_RULES.sweepMs);

    expect(riya.outcomes[0].outcome).toBe(QUICK_MATCH_OUTCOMES.PERSON);
    expect(riya.outcomes[0].room.options).toEqual({ timeControl: "blitz-3+2" });
    expect(arjun.outcomes[0].room.code).toBe(riya.outcomes[0].room.code);
  });

  it("chess never pairs past the widest window", async () => {
    const { search, time } = setup({ ratings: { [RIYA.id]: 1200, [ARJUN.id]: 1550 } });

    const riya = search(RIYA, { gameId: GAME_IDS.CHESS });
    const arjun = search(ARJUN, { gameId: GAME_IDS.CHESS });
    await settled();
    await time.advance(SEARCH_MS);

    expect([riya, arjun].map(({ outcomes }) => outcomes[0].outcome)).toEqual([
      QUICK_MATCH_OUTCOMES.CHARACTER,
      QUICK_MATCH_OUTCOMES.CHARACTER,
    ]);
  });

  it("pairs the same two people at most the daily cap times in 24 hours", async () => {
    const { search, time } = setup({ rules: { pairsPerDay: 2 } });
    const play = async () => {
      const riya = search(RIYA);
      const arjun = search(ARJUN);
      await settled();
      await time.advance(SEARCH_MS);
      return [riya, arjun].map(({ outcomes }) => outcomes[0].outcome);
    };

    expect(await play()).toEqual(["person", "person"]);
    expect(await play()).toEqual(["person", "person"]);
    expect(await play()).toEqual(["character", "character"]);
  });

  it("ends a search with the room's refusal when its room cannot be made, once", async () => {
    const { search, time, rooms } = setup();
    for (let index = 0; index < 3; index++) {
      await rooms.createRoom({ host: RIYA, network: NETWORK, gameId: "rps", options: {}, now: START });
    }

    const riya = search(RIYA);
    await settled();
    await time.advance(SEARCH_MS);

    expect(riya.outcomes).toHaveLength(1);
    expect(riya.outcomes[0]).toBeInstanceOf(ConflictError);
  });

  it("counts every outcome anonymously: by day, hour, game and outcome, waits in buckets, no id of anyone", async () => {
    const { search, time, matchmaking, counts } = setup();

    search(RIYA);
    search(ARJUN);
    await settled();
    search(MEERA);
    await settled();
    await time.advance(SEARCH_MS);
    search(KABIR, { othersOnline: 0 });
    await settled();
    search(RIYA);
    await settled();
    await matchmaking.cancel({ playerId: RIYA.id });

    const rows = counts.drain();
    const total = (outcome) =>
      rows.filter((row) => row.outcome === outcome).reduce((sum, row) => sum + row.searches, 0);
    expect(total(COUNT_OUTCOMES.MATCHED)).toBe(2);
    expect(total(COUNT_OUTCOMES.TIMED_OUT)).toBe(1);
    expect(total(COUNT_OUTCOMES.SKIPPED)).toBe(1);
    expect(total(COUNT_OUTCOMES.CANCELLED)).toBe(1);
    expect(rows.find((row) => row.outcome === COUNT_OUTCOMES.TIMED_OUT).waits).toEqual({ upto_4000: 1 });
    const strings = JSON.stringify(rows)
      .match(/"[^"]*"/g)
      .map((text) => text.slice(1, -1));
    expect(strings.filter(hasPlayerIdShape)).toEqual([]);
    expect(JSON.stringify(rows)).not.toMatch(/Riya|Arjun|ROOM|socket/);
  });

  it("chess searches in neighbouring rating bands are looked at again as the window widens", async () => {
    // 1650 is in the 1500 to 1799 band and 1900 in the next one: 250 points apart, inside the window after 3 s.
    const { search, time } = setup({ ratings: { [RIYA.id]: 1650, [ARJUN.id]: 1900 } });

    const riya = search(RIYA, { gameId: GAME_IDS.CHESS });
    const arjun = search(ARJUN, { gameId: GAME_IDS.CHESS });
    await settled();
    expect(riya.outcomes).toEqual([]);
    await time.advance(3_000 + MATCHMAKING_RULES.sweepMs);

    expect(riya.outcomes.map((result) => result.outcome)).toEqual([QUICK_MATCH_OUTCOMES.PERSON]);
    expect(arjun.outcomes[0].room.code).toBe(riya.outcomes[0].room.code);
  });

  it("forgets a pairing 24 hours after it, so no pair of player ids stays in memory longer", async () => {
    const { search, time, matchmaking } = setup();
    search(RIYA);
    search(ARJUN);
    await settled();
    expect(matchmaking.heldPairs()).toBe(1);

    await time.advance(24 * 3_600_000 + 1);
    search(MEERA, { othersOnline: 0 });
    await settled();

    expect(matchmaking.heldPairs()).toBe(0);
  });

  it("race: a cancel while the person is sitting down is kept, so a join that fails ends the search, never restarts it", async () => {
    // Arjun's seat in Riya's room is refused a moment after Riya's tab closed.
    let refuse = () => {};
    const refusingJoin = (rooms) => ({
      ...rooms,
      joinRoom: (input) =>
        input.player.id === ARJUN.id
          ? new Promise((_, reject) => (refuse = () => reject(new ConflictError("This room is full"))))
          : rooms.joinRoom(input),
    });
    const { search, time, matchmaking } = setup({ wrapRooms: refusingJoin });

    const riya = search(RIYA);
    await settled();
    const arjun = search(ARJUN);
    await settled();
    const cancel = matchmaking.cancel({ playerId: RIYA.id, socketId: `socket-${RIYA.id}` });
    refuse();
    await settled();

    expect(await cancel).toEqual({ cancelled: true });
    expect(riya.outcomes).toEqual([{ outcome: QUICK_MATCH_OUTCOMES.CANCELLED }]);
    await time.advance(SEARCH_MS);
    expect(arjun.outcomes.map((result) => result.outcome)).toEqual([QUICK_MATCH_OUTCOMES.CHARACTER]);
  });

  /** 20 pairs where the older search waited 100 ms, 200 ms and so on up to 2 s before its partner came. */
  async function twentyPairs({ search, time }) {
    // A new pair each time, so the cap per pair never stops one.
    const guest = (name, index) =>
      Object.freeze({
        kind: "guest",
        id: `guest_00000000-0000-4000-8000-${String(index).padStart(10, "0")}${name}`,
        displayName: `${name}${index}`,
      });
    for (let index = 1; index <= 20; index++) {
      search(guest("aa", index));
      await settled();
      await time.advance(index * 100);
      search(guest("bb", index));
      await settled();
    }
  }

  it("times the search by how long the older side waited for its partner, never by the newer side's instant", async () => {
    const world = setup();
    await twentyPairs(world);

    const meera = world.search(MEERA);
    await settled();
    await world.time.advance(1_599);
    expect(meera.outcomes).toEqual([]);
    await world.time.advance(1);

    // The 80th percentile of 100 ms to 2 s is 1.6 s. Counting the newer side's waits too would give 1.2 s.
    expect(meera.outcomes.map((result) => result.outcome)).toEqual([QUICK_MATCH_OUTCOMES.CHARACTER]);
  });

  it("lets a share of searches look the full time, so a short timeout can grow again", async () => {
    // The 41st search is a probe when one in 41 is.
    const world = setup({ rules: { probeEvery: 41 } });
    await twentyPairs(world);

    const meera = world.search(MEERA);
    await settled();
    await world.time.advance(SEARCH_MS - 1);
    expect(meera.outcomes).toEqual([]);
    await world.time.advance(1);

    expect(meera.outcomes.map((result) => result.outcome)).toEqual([QUICK_MATCH_OUTCOMES.CHARACTER]);
  });
});
