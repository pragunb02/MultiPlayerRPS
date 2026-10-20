import { describe, expect, it } from "vitest";
import { createReportAccessor } from "../../data/reportAccessor.js";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { createInMemoryReportDao } from "../../testing/inMemoryReportDao.js";
import { ConflictError, GoneError, NotFoundError } from "../../utils/errors.js";
import { createPlayerReferences } from "../players/playerReferences.js";
import { createSeatIds } from "../rooms/seatIds.js";
import { createReportComponent, REPORTER_TRUST } from "./reportComponent.js";

// CC-044, ADR-071: reports. A player names the other by where they met, never by an id; the server keeps who was
// reported, snapshots what happened, and the owner sees one group per reported player without any id.

const RIYA = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" });
const ARJUN = Object.freeze({ kind: "user", id: "user_ffffffffffffffffffffffff", displayName: "Arjun" });
const GUEST = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-000000000001",
  displayName: "Guest-T001",
});
const MEERA = Object.freeze({ kind: "user", id: "user_aaaaaaaaaaaaaaaaaaaaaaaa", displayName: "Meera" });
const BOT = "bot_bit_easy";
const T0 = Date.UTC(2026, 9, 20, 6); // 11:30 in India
const DAY_MS = 24 * 60 * 60 * 1000;
const SEAT_IDS = createSeatIds({ secret: "seat-secret-for-tests-only-0123456789abcdef" });
const MATCH_ID = "11111111-2222-4333-8444-555555555555";
const HANDLE = "abcdefghjkmnpqrs";

const seat = (player) => ({ playerId: player.id, displayName: player.displayName });
const move = (player, value, at) => ({ kind: "move", playerId: player.id, move: value, at });

const room = (overrides = {}) => ({
  code: "ROOM22",
  gameId: "rps",
  createdAt: T0 - 60_000,
  status: "finished",
  seats: [seat(RIYA), seat(ARJUN)],
  game: {
    matchId: MATCH_ID,
    log: [move(RIYA, { choice: "rock" }, T0 - 2000), move(ARJUN, "paper", T0 - 1000)],
  },
  requests: [{ type: "rematch", from: ARJUN.id, to: RIYA.id, state: "declined", createdAt: T0 - 500 }],
  ...overrides,
});

function fakeRooms(rooms) {
  return {
    async getByCode(code) {
      if (code === "GONE22") throw new GoneError("This room has closed");
      if (!Object.hasOwn(rooms, code)) throw new NotFoundError("Room not found");
      return rooms[code];
    },
  };
}

function fakeMatches(matches) {
  return {
    async playersFor({ matchId, playerId }) {
      const match = matches[matchId];
      if (match === undefined || !match.players.some((p) => p.playerId === playerId)) {
        throw new NotFoundError("Match not found");
      }
      return match.players;
    },
    async getById(matchId) {
      return matches[matchId];
    },
  };
}

const fakeTransfers = (moves = {}) => ({
  listFrom: async (ids) =>
    ids.filter((id) => Object.hasOwn(moves, id)).map((id) => ({ from: id, to: moves[id] })),
});

/** Profiles by handle: only an adult account's profile names someone who can be reported. */
const fakeProfiles = (people = { [HANDLE]: seat(MEERA) }) => ({
  async personByHandle({ handle }) {
    if (!Object.hasOwn(people, handle)) throw new NotFoundError("No such player");
    return people[handle];
  },
});

let ids = 0;
function setup({ rooms = { ROOM22: room() }, matches = {}, profiles = fakeProfiles(), moves = {} } = {}) {
  const dao = createInMemoryReportDao();
  const renamed = [];
  const reports = createReportComponent({
    reportAccessor: createReportAccessor({ reportDao: dao }),
    references: createPlayerReferences({
      rooms: fakeRooms(rooms),
      matches: fakeMatches(matches),
      transfers: fakeTransfers(moves),
      seatIds: SEAT_IDS,
    }),
    matches: fakeMatches(matches),
    profiles,
    names: {
      async resetName({ playerId }) {
        renamed.push(playerId);
        return "Player_ABCDEF";
      },
    },
    newReportId: () => `00000000-0000-4000-d000-${String(++ids).padStart(12, "0")}`,
    newUuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  });
  const inRoom = (index, code = "ROOM22") => ({
    roomCode: code,
    seat: index,
    seatId: SEAT_IDS.seatIdOf(rooms[code] ?? room(), (rooms[code] ?? room()).seats[index]?.playerId ?? ""),
  });
  return { reports, dao, renamed, inRoom };
}

const stringsIn = (value) =>
  typeof value === "string"
    ? [value]
    : value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, item]) => [key, ...stringsIn(item)])
      : [];

const NOT_FOUND = { message: "We couldn't find that player" };

describe("reportComponent.report: who can be reported (CC-044, ADR-071.1)", () => {
  it("reports the other player of a room seat, keeps who it was on the server, and answers only the report's id", async () => {
    const { reports, dao, inRoom } = setup();

    const answer = await reports.report({ reporter: RIYA, target: inRoom(1), reason: "name", now: T0 });

    expect(answer).toEqual({ reportId: expect.any(String), createdAt: T0 });
    const stored = await dao.getById(answer.reportId);
    expect(stored).toMatchObject({
      reporterId: RIYA.id,
      reportedId: ARJUN.id,
      reportedName: "Arjun",
      reason: "name",
      day: "2026-10-20",
      setAside: false,
      status: "open",
      context: { kind: "room", gameId: "rps", roomCode: "ROOM22", matchId: MATCH_ID },
    });
    expect(stored).not.toHaveProperty("note");
  });

  it("snapshots the last moves and requests between the two, players named only by role", async () => {
    const { reports, dao, inRoom } = setup();

    const { reportId } = await reports.report({
      reporter: RIYA,
      target: inRoom(1),
      reason: "cheating",
      now: T0,
    });

    const { context } = await dao.getById(reportId);
    expect(context.recent).toEqual([
      { by: "reporter", kind: "move", text: '{"choice":"rock"}', at: new Date(T0 - 2000) },
      { by: "reported", kind: "move", text: '"paper"', at: new Date(T0 - 1000) },
      { by: "reported", kind: "request", text: "rematch declined", at: new Date(T0 - 500) },
    ]);
    expect(stringsIn(context).filter(hasPlayerIdShape)).toEqual([]);
  });

  it("keeps the last 10 moves and 5 requests, cuts a long move, and hides any id inside a move", async () => {
    const log = Array.from({ length: 14 }, (_, i) => move(i % 2 ? ARJUN : RIYA, { n: i }, T0 - 100 + i));
    log.push(move(ARJUN, { target: RIYA.id, text: "x".repeat(400) }, T0 - 50));
    const requests = Array.from({ length: 7 }, (_, i) => ({
      type: "rematch",
      from: RIYA.id,
      to: ARJUN.id,
      state: "open",
      createdAt: T0 - 40 + i,
    }));
    const { reports, dao, inRoom } = setup({
      rooms: { ROOM22: room({ game: { matchId: MATCH_ID, log }, requests }) },
    });

    const { reportId } = await reports.report({
      reporter: RIYA,
      target: inRoom(1),
      reason: "cheating",
      now: T0,
    });

    const { recent } = (await dao.getById(reportId)).context;
    expect(recent.filter((entry) => entry.kind === "move")).toHaveLength(10);
    expect(recent.filter((entry) => entry.kind === "request")).toHaveLength(5);
    const last = recent.filter((entry) => entry.kind === "move").at(-1);
    expect(last.text.length).toBeLessThanOrEqual(200);
    expect(last.text).toContain('"target":"reporter"');
    expect(stringsIn(recent).filter(hasPlayerIdShape)).toEqual([]);
  });

  it("labels a third player in the room as other", async () => {
    const rooms = {
      ROOM22: room({
        seats: [seat(RIYA), seat(ARJUN), seat(MEERA)],
        game: { matchId: MATCH_ID, log: [move(MEERA, 1, T0 - 10)] },
        requests: [],
      }),
    };
    const { reports, dao, inRoom } = setup({ rooms });

    const { reportId } = await reports.report({
      reporter: RIYA,
      target: inRoom(1),
      reason: "other",
      now: T0,
    });

    expect((await dao.getById(reportId)).context.recent).toEqual([
      { by: "other", kind: "move", text: "1", at: new Date(T0 - 10) },
    ]);
  });

  it("reports a player of a stored match both played, with that match's last moves", async () => {
    const matches = {
      [MATCH_ID]: {
        matchId: MATCH_ID,
        gameId: "chess",
        players: [seat(ARJUN), seat(RIYA)],
        log: [move(ARJUN, "e4", T0 - 3000), { kind: "forfeit", playerId: ARJUN.id, at: T0 - 2000 }],
      },
    };
    const { reports, dao } = setup({ matches });

    const { reportId } = await reports.report({
      reporter: RIYA,
      target: { matchId: MATCH_ID, seat: 0 },
      reason: "cheating",
      now: T0,
    });

    expect((await dao.getById(reportId)).context).toEqual({
      kind: "match",
      gameId: "chess",
      matchId: MATCH_ID,
      recent: [{ by: "reported", kind: "move", text: '"e4"', at: new Date(T0 - 3000) }],
    });
  });

  it("reports the adult behind a public profile handle, with nothing but the handle's context", async () => {
    const { reports, dao } = setup();

    const { reportId } = await reports.report({
      reporter: RIYA,
      target: { handle: HANDLE },
      reason: "name",
      now: T0,
    });

    expect(await dao.getById(reportId)).toMatchObject({
      reportedId: MEERA.id,
      reportedName: "Meera",
      context: { kind: "profile" },
    });
    expect((await dao.getById(reportId)).context).toEqual({ kind: "profile" });
  });

  it("answers one 404 for a stranger's room, a closed room, a seat that moved, yourself, a computer and an unknown handle", async () => {
    const rooms = {
      ROOM22: room(),
      BOTS22: room({ code: "BOTS22", seats: [seat(RIYA), { playerId: BOT, displayName: "Bit" }] }),
    };
    const { reports, inRoom } = setup({ rooms, profiles: fakeProfiles({ [HANDLE]: seat(RIYA) }) });
    const tries = [
      { reporter: MEERA, target: inRoom(1) },
      { reporter: RIYA, target: { ...inRoom(1), roomCode: "GONE22" } },
      { reporter: RIYA, target: { ...inRoom(1), seatId: "A".repeat(22) } },
      { reporter: RIYA, target: inRoom(0) },
      { reporter: RIYA, target: inRoom(1, "BOTS22") },
      { reporter: RIYA, target: { matchId: MATCH_ID, seat: 0 } },
      { reporter: RIYA, target: { handle: "zzzzzzzzzzzzzzzz" } },
      { reporter: RIYA, target: { handle: HANDLE } },
    ];

    for (const { reporter, target } of tries) {
      await expect(reports.report({ reporter, target, reason: "name", now: T0 })).rejects.toMatchObject(
        NOT_FOUND,
      );
    }
  });

  it("reports a guest who signed in since as their account (ADR-014)", async () => {
    const rooms = { ROOM22: room({ seats: [seat(RIYA), seat(GUEST)] }) };
    const { reports, dao, inRoom } = setup({ rooms, moves: { [GUEST.id]: ARJUN } });

    const { reportId } = await reports.report({ reporter: RIYA, target: inRoom(1), reason: "name", now: T0 });

    expect(await dao.getById(reportId)).toMatchObject({ reportedId: ARJUN.id, reportedName: "Guest-T001" });
  });
});

describe("reportComponent.report: the note and the limits (CC-044, ADR-071.2, ADR-071.5)", () => {
  it("masks emails and phone numbers in the note before it is stored", async () => {
    const { reports, dao, inRoom } = setup();

    const { reportId } = await reports.report({
      reporter: RIYA,
      target: inRoom(1),
      reason: "harassment",
      note: "He asked for my number, mine is 98765 43210 and riya@example.com",
      now: T0,
    });

    expect((await dao.getById(reportId)).note).toBe(
      "He asked for my number, mine is [phone removed] and [email removed]",
    );
  });

  it("answers the same report for a second one on the same player the same India day, and a new one the next day", async () => {
    const { reports, dao, inRoom } = setup();
    const first = await reports.report({ reporter: RIYA, target: inRoom(1), reason: "name", now: T0 });

    const again = await reports.report({
      reporter: RIYA,
      target: inRoom(1),
      reason: "other",
      now: T0 + 60_000,
    });
    const tomorrow = await reports.report({
      reporter: RIYA,
      target: inRoom(1),
      reason: "name",
      now: T0 + DAY_MS,
    });

    expect(again).toEqual(first);
    expect(tomorrow.reportId).not.toBe(first.reportId);
    expect(await dao.listByReporter(RIYA.id)).toHaveLength(2);
  });

  it(`sets aside new reports from a reporter with ${REPORTER_TRUST.dismissedAtLeast} dismissed and none acted on, with the same answer`, async () => {
    const { reports, dao, inRoom } = setup();
    for (let day = 0; day < REPORTER_TRUST.dismissedAtLeast; day += 1) {
      const { reportId } = await reports.report({
        reporter: RIYA,
        target: inRoom(1),
        reason: "name",
        now: T0 + day * DAY_MS,
      });
      await reports.act({ reportId, action: "dismiss", now: T0 + day * DAY_MS + 1 });
    }

    const answer = await reports.report({
      reporter: RIYA,
      target: inRoom(1),
      reason: "name",
      now: T0 + 9 * DAY_MS,
    });

    expect(answer).toEqual({ reportId: expect.any(String), createdAt: T0 + 9 * DAY_MS });
    expect((await dao.getById(answer.reportId)).setAside).toBe(true);
  });

  it("does not set aside a reporter one of whose reports was acted on", async () => {
    const { reports, dao, inRoom } = setup();
    for (let day = 0; day < REPORTER_TRUST.dismissedAtLeast; day += 1) {
      const { reportId } = await reports.report({
        reporter: RIYA,
        target: inRoom(1),
        reason: "name",
        now: T0 + day * DAY_MS,
      });
      await reports.act({ reportId, action: "dismiss", now: T0 + day * DAY_MS + 1 });
    }
    const { reportId } = await reports.report({
      reporter: RIYA,
      target: inRoom(1),
      reason: "name",
      now: T0 + 5 * DAY_MS,
    });
    await reports.act({ reportId, action: "rename", now: T0 + 5 * DAY_MS + 1 });

    const answer = await reports.report({
      reporter: RIYA,
      target: inRoom(1),
      reason: "name",
      now: T0 + 9 * DAY_MS,
    });

    expect((await dao.getById(answer.reportId)).setAside).toBe(false);
  });
});

describe("reportComponent.reportedBy: the one-tap block after a report (ADR-071.4)", () => {
  it("answers the person of the reporter's own report, and 404 for anyone else's or an unknown one", async () => {
    const { reports, inRoom } = setup();
    const { reportId } = await reports.report({ reporter: RIYA, target: inRoom(1), reason: "name", now: T0 });

    expect(await reports.reportedBy({ reportId, reporterId: RIYA.id })).toEqual({
      playerId: ARJUN.id,
      displayName: "Arjun",
    });
    await expect(reports.reportedBy({ reportId, reporterId: ARJUN.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      reports.reportedBy({ reportId: "00000000-0000-4000-d000-ffffffffffff", reporterId: RIYA.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("reportComponent.queue and act: the owner's view (ADR-071.6)", () => {
  async function threeReports() {
    const fixture = setup({
      rooms: {
        ROOM22: room(),
        ROOM33: room({ code: "ROOM33", seats: [seat(MEERA), seat(ARJUN)] }),
        ROOM44: room({ code: "ROOM44", seats: [seat(RIYA), seat(GUEST)], requests: [] }),
      },
    });
    const { reports, inRoom } = fixture;
    await reports.report({ reporter: RIYA, target: inRoom(1), reason: "name", note: "bad", now: T0 });
    await reports.report({ reporter: MEERA, target: inRoom(1, "ROOM33"), reason: "cheating", now: T0 + 10 });
    await reports.report({ reporter: RIYA, target: inRoom(1, "ROOM44"), reason: "other", now: T0 + 20 });
    return fixture;
  }

  it("groups open reports by reported player, counts reasons and reporters, and sends no player id", async () => {
    const { reports } = await threeReports();

    const { groups } = await reports.queue({ status: "open", limit: 100 });

    expect(groups).toHaveLength(2);
    const [arjun] = groups.filter((group) => group.names.includes("Arjun"));
    expect(arjun).toMatchObject({
      groupId: expect.any(String),
      kind: "account",
      canRename: true,
      names: ["Arjun"],
      reports: 2,
      reporters: 2,
      setAside: 0,
      reasons: { name: 1, cheating: 1, harassment: 0, other: 0 },
      lastAt: T0 + 10,
    });
    expect(arjun.items.map((item) => item.reason)).toEqual(["cheating", "name"]);
    expect(arjun.items[1]).toEqual({
      reportId: expect.any(String),
      reason: "name",
      note: "bad",
      nameThen: "Arjun",
      context: expect.objectContaining({ kind: "room", roomCode: "ROOM22" }),
      setAside: false,
      createdAt: T0,
    });
    expect(groups.find((group) => group.kind === "guest")).toMatchObject({ canRename: false });
    expect(stringsIn(groups).filter(hasPlayerIdShape)).toEqual([]);
    expect(JSON.stringify(groups)).not.toMatch(/reporterId|reportedId/);
  });

  it("lists groups with the most reporters first, and set aside reports last", async () => {
    const { reports } = await threeReports();

    const { groups } = await reports.queue({ status: "open", limit: 100 });

    expect(groups.map((group) => group.reporters)).toEqual([2, 1]);
  });

  it("dismisses every open report about the player of a group at once", async () => {
    const { reports } = await threeReports();
    const { groups } = await reports.queue({ status: "open", limit: 100 });
    const arjun = groups.find((group) => group.names.includes("Arjun"));

    const result = await reports.act({ reportId: arjun.items[1].reportId, action: "dismiss", now: T0 + 99 });

    expect(result).toEqual({ closed: 2 });
    const after = await reports.queue({ status: "open", limit: 100 });
    expect(after.groups.map((group) => group.kind)).toEqual(["guest"]);
    const dismissed = await reports.queue({ status: "dismissed", limit: 100 });
    expect(
      dismissed.groups[0].items.every((item) => item.action === "dismiss" && item.closedAt === T0 + 99),
    ).toBe(true);
  });

  it("renames an account to the safe default and closes its reports as acted on", async () => {
    const { reports, renamed } = await threeReports();
    const { groups } = await reports.queue({ status: "open", limit: 100 });
    const arjun = groups.find((group) => group.names.includes("Arjun"));

    const result = await reports.act({ reportId: arjun.groupId, action: "rename", now: T0 + 99 });

    expect(result).toEqual({ closed: 2, displayName: "Player_ABCDEF" });
    expect(renamed).toEqual([ARJUN.id]);
    expect((await reports.queue({ status: "actioned", limit: 100 })).groups).toHaveLength(1);
  });

  it("refuses to rename a guest, whose name the server gave, and to act on a closed or unknown report", async () => {
    const { reports, renamed } = await threeReports();
    const { groups } = await reports.queue({ status: "open", limit: 100 });
    const guest = groups.find((group) => group.kind === "guest");
    const arjun = groups.find((group) => group.names.includes("Arjun"));
    await reports.act({ reportId: arjun.groupId, action: "dismiss", now: T0 + 99 });

    await expect(reports.act({ reportId: guest.groupId, action: "rename", now: T0 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(reports.act({ reportId: arjun.groupId, action: "dismiss", now: T0 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      reports.act({ reportId: "00000000-0000-4000-d000-ffffffffffff", action: "dismiss", now: T0 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(renamed).toEqual([]);
  });
});

describe("reportComponent: guests who sign in, export and deletion (ADR-071.7)", () => {
  it("moves a guest's reports, made and received, to the account", async () => {
    const rooms = { ROOM22: room({ seats: [seat(GUEST), seat(ARJUN)], requests: [] }) };
    const { reports, dao, inRoom } = setup({ rooms });
    await reports.report({ reporter: GUEST, target: inRoom(1), reason: "name", now: T0 });

    const moved = await reports.transferPlayer({ from: GUEST.id, to: RIYA, now: T0 });

    expect(moved).toEqual({ moved: { reports: 1 } });
    expect(await dao.listByReporter(RIYA.id)).toHaveLength(1);
  });

  it("exports the reports the player made, without the reported player's id or what happened", async () => {
    const { reports, inRoom } = setup();
    const { reportId } = await reports.report({
      reporter: RIYA,
      target: inRoom(1),
      reason: "name",
      note: "n",
      now: T0,
    });
    await reports.act({ reportId, action: "rename", now: T0 + 1 });

    const exported = await reports.exportPlayer({ playerId: RIYA.id });

    expect(exported).toEqual([
      {
        reason: "name",
        note: "n",
        where: "room",
        displayName: "Arjun",
        reportedAt: new Date(T0).toISOString(),
      },
    ]);
    expect(await reports.exportPlayer({ playerId: ARJUN.id })).toEqual([]);
    expect(stringsIn(exported).filter(hasPlayerIdShape)).toEqual([]);
  });

  it("erases reports about the player, and keeps the reports they made under a stand-in without the note", async () => {
    const rooms = { ROOM22: room(), ROOM33: room({ code: "ROOM33", seats: [seat(ARJUN), seat(RIYA)] }) };
    const { reports, dao, inRoom } = setup({ rooms });
    const made = await reports.report({
      reporter: RIYA,
      target: inRoom(1),
      reason: "name",
      note: "n",
      now: T0,
    });
    const about = await reports.report({
      reporter: ARJUN,
      target: inRoom(1, "ROOM33"),
      reason: "name",
      now: T0,
    });

    const erased = await reports.erasePlayer({ playerId: RIYA.id });

    expect(erased).toEqual({ erased: { reports: 2 } });
    const kept = await dao.getById(made.reportId);
    expect(kept.reporterId).toMatch(/^deleted_/);
    expect(kept).not.toHaveProperty("note");
    await expect(dao.getById(about.reportId)).rejects.toBeInstanceOf(RangeError);
  });
});
