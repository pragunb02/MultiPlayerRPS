import { describe, expect, it } from "vitest";
import { CHALLENGE_LIMIT_REASONS, CHALLENGE_STATES, INVITE_KEEP_AFTER_MS } from "@classicade/shared";
import { createChallengeAccessor } from "../../data/challengeAccessor.js";
import { safetyFromAdults } from "../../testing/fakeSafety.js";
import { createInMemoryChallengeDao } from "../../testing/inMemoryChallengeDao.js";
import { ConflictError, ForbiddenError, GoneError, NotFoundError } from "../../utils/errors.js";
import { CHALLENGE_EVENTS, createChallengeComponent } from "./challengeComponent.js";

// Invites to friends (CC-052 part 2) on top of challenges to one person (CC-139): groups and "Game filled", keeping
// an invite for later, invites back, quiet hours and the sender's view of a no.

const RIYA = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" });
const ARJUN = Object.freeze({ kind: "user", id: "user_ffffffffffffffffffffffff", displayName: "Arjun" });
const MEERA = Object.freeze({ kind: "user", id: "user_eeeeeeeeeeeeeeeeeeeeeeee", displayName: "Meera" });
const KABIR = Object.freeze({ kind: "user", id: "user_dddddddddddddddddddddddd", displayName: "Kabir" });
const PEOPLE = [RIYA, ARJUN, MEERA, KABIR];
/** 12:00 UTC is 17:30 in India, outside quiet hours. 17:00 UTC is 22:30 in India, inside them. */
const T0 = Date.UTC(2026, 9, 20, 12);
const NIGHT = Date.UTC(2026, 9, 20, 17);
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const CHESS = Object.freeze({ timeControl: "5+0" });

/**
 * Riya, Arjun and Meera are adults, Kabir is not. A friend is named by handle (their name in lower case here) or,
 * for an invite back, by player id, as the real policy is (friendInvites.js).
 */
function setup({
  blocked = [],
  adults = [RIYA.id, ARJUN.id, MEERA.id],
  rooms: roomOverrides = {},
  wrap = (accessor) => accessor,
} = {}) {
  const emitted = [];
  const madeRooms = [];
  let ids = 0;
  const accessor = createChallengeAccessor({ challengeDao: createInMemoryChallengeDao() });
  const resolved = [];
  const challenges = createChallengeComponent({
    challengeAccessor: wrap(accessor),
    rooms: {
      checkOptions: ({ options }) => ({ timeControl: "5+0", ...options }),
      createChallengeRoom: async (input) => {
        madeRooms.push(input);
        return { code: `ROOM0${madeRooms.length}`, gameId: input.gameId };
      },
      ...roomOverrides,
    },
    blocks: {
      blockedWith: async ({ playerId }) =>
        new Set(blocked.flatMap(([a, b]) => (a === playerId ? [b] : b === playerId ? [a] : []))),
    },
    safety: safetyFromAdults(({ playerIds }) => playerIds.filter((id) => adults.includes(id))),
    events: { emit: (event, payload) => emitted.push({ event, ...payload }) },
    recipients: {
      resolve: async ({ from, target }) => {
        resolved.push({ from: from.id, target });
        const person = PEOPLE.find(
          (each) => each.displayName.toLowerCase() === target.handle || each.id === target.playerId,
        );
        if (person === undefined) throw new NotFoundError("We couldn't find that player");
        return { id: person.id, displayName: person.displayName };
      },
    },
    newId: () => `c${String(++ids).padStart(19, "0")}`,
  });
  const invite = ({ from = RIYA, to = "arjun", gameId = "chess", now = T0 } = {}) =>
    challenges.create({ from, gameId, options: CHESS, to: { handle: to }, now });
  const accept = (id, player, now = T0 + MINUTE) =>
    challenges.accept({ challengeId: id, player, network: "net", now });
  const view = (id, viewer, now = T0 + 2 * MINUTE) =>
    challenges.view({ challengeId: id, viewerId: viewer.id, now });
  return { challenges, invite, accept, view, emitted, madeRooms, accessor, resolved };
}

describe("challengeComponent: invites to friends (CC-052)", () => {
  it("marks every view of an invite as one to one person, and no view of a link", async () => {
    const { challenges, invite } = setup();
    const own = await invite();
    const link = await challenges.create({ from: RIYA, gameId: "chess", options: CHESS, now: T0 });

    expect(own.toOne).toBe(true);
    expect((await challenges.view({ challengeId: own.id, viewerId: "", now: T0 })).toOne).toBe(true);
    expect(link.toOne).toBeUndefined();
  });

  it("puts an invite straight into the inbox in the recipient's quiet hours", async () => {
    const { challenges, invite } = setup();
    const atNight = await invite({ to: "kabir", now: NIGHT });
    const byDay = await invite({ to: "kabir", gameId: "rps", now: T0 });
    const toAnAdult = await invite({ to: "arjun", now: NIGHT });

    const kabirsNight = await challenges.inbox({ playerId: KABIR.id, now: NIGHT + 1 });
    const kabirsDay = await challenges.inbox({ playerId: KABIR.id, now: T0 + 1 });
    const arjuns = await challenges.inbox({ playerId: ARJUN.id, now: NIGHT + 1 });

    // In Kabir's night every invite waits in the inbox, even one sent in the day: no popup, no sound.
    expect(kabirsNight.map(({ id, later }) => [id, later])).toEqual([
      [atNight.id, true],
      [byDay.id, true],
    ]);
    // By day, only the one that arrived at night is still in the inbox. An adult has no quiet hours.
    expect(kabirsDay.map(({ id, later }) => [id, later])).toEqual([
      [atNight.id, true],
      [byDay.id, false],
    ]);
    expect(arjuns.map(({ id, later }) => [id, later])).toEqual([[toAnAdult.id, false]]);
  });

  it("lets the first friend to accept play, and fills the sender's other invites to that game", async () => {
    const { invite, accept, view, madeRooms, emitted } = setup();
    const toArjun = await invite({ to: "arjun" });
    const toMeera = await invite({ to: "meera", now: T0 + 1 });
    const toKabirAtRps = await invite({ to: "kabir", gameId: "rps", now: T0 + 2 });

    await accept(toArjun.id, ARJUN);

    expect(madeRooms).toHaveLength(1);
    const meeras = await view(toMeera.id, MEERA);
    expect(meeras).toMatchObject({ state: CHALLENGE_STATES.FILLED, forYou: true, fromName: "Riya" });
    expect(emitted.at(-1)).toMatchObject({ event: CHALLENGE_EVENTS.CHANGED, playerIds: [RIYA.id, MEERA.id] });
    // An invite to another game is not filled.
    expect((await view(toKabirAtRps.id, KABIR)).state).toBe(CHALLENGE_STATES.OPEN);
    const late = await accept(toMeera.id, MEERA, T0 + 2 * MINUTE).catch((err) => err);
    expect(late).toBeInstanceOf(GoneError);
    expect(late.details).toEqual({ state: CHALLENGE_STATES.FILLED });
  });

  it("lets only the first of two friends accepting at once play, and fills the others", async () => {
    let release;
    const slow = new Promise((resolve) => {
      release = resolve;
    });
    const made = [];
    const { invite, accept, view } = setup({
      rooms: {
        createChallengeRoom: async (input) => {
          made.push(input.accepter.id);
          await slow;
          return { code: "ROOM01", gameId: input.gameId };
        },
      },
    });
    const toArjun = await invite({ to: "arjun" });
    const toMeera = await invite({ to: "meera", now: T0 + 1 });

    const arjunTakes = accept(toArjun.id, ARJUN);
    const meeraTakes = accept(toMeera.id, MEERA).catch((err) => err);
    const meeraAnswer = await meeraTakes;
    release();
    await arjunTakes;

    expect(made).toEqual([ARJUN.id]);
    expect(meeraAnswer).toBeInstanceOf(GoneError);
    expect(meeraAnswer.details).toEqual({ state: CHALLENGE_STATES.FILLED });
    expect((await view(toMeera.id, MEERA)).state).toBe(CHALLENGE_STATES.FILLED);
    expect((await view(toArjun.id, ARJUN)).state).toBe(CHALLENGE_STATES.ACCEPTED);
  });

  it("frees the group when the winner's room cannot be made, so another friend can play", async () => {
    let fail = true;
    const { invite, accept, madeRooms } = setup({
      rooms: {
        createChallengeRoom: async (input) => {
          if (fail) throw new ConflictError("You are in too many rooms");
          madeRooms.push(input);
          return { code: "ROOM01", gameId: input.gameId };
        },
      },
    });
    const toArjun = await invite({ to: "arjun" });
    const toMeera = await invite({ to: "meera", now: T0 + 1 });

    await expect(accept(toArjun.id, ARJUN)).rejects.toThrow(ConflictError);
    fail = false;

    await expect(accept(toMeera.id, MEERA)).resolves.toMatchObject({ room: { code: "ROOM01" } });
  });

  it("lets a friend play when the group's holder lost its hold, and starts a new group once one is filled", async () => {
    const { invite, accept, accessor, challenges } = setup();
    const toArjun = await invite({ to: "arjun" });
    const toMeera = await invite({ to: "meera", now: T0 + 1 });
    // Arjun's take was cut off after it claimed the group: his hold and the group's claim are left behind.
    await accessor.claim({
      challengeId: toArjun.id,
      acceptedBy: ARJUN.id,
      acceptedName: "Arjun",
      at: T0,
      staleBefore: T0 - 1,
    });
    await accessor.claimGroup({ groupId: toArjun.id, by: toArjun.id, from: "" });

    await expect(accept(toMeera.id, MEERA, T0 + MINUTE)).resolves.toMatchObject({ room: { code: "ROOM01" } });
    const next = await invite({ to: "kabir", now: T0 + 2 * MINUTE });
    expect((await challenges.inbox({ playerId: KABIR.id, now: T0 + 3 * MINUTE }))[0].id).toBe(next.id);
    await expect(accept(next.id, KABIR, T0 + 3 * MINUTE)).resolves.toMatchObject({
      room: { code: "ROOM02" },
    });
  });

  it("announces a taken invite once, for its flag's success", async () => {
    const { invite, accept, emitted } = setup();
    const { id } = await invite();

    await accept(id, ARJUN);

    const accepted = emitted.filter(({ event }) => event === CHALLENGE_EVENTS.ACCEPTED);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].challenge).toMatchObject({ challengeId: id, toId: ARJUN.id, roomCode: "ROOM01" });
  });

  it("gives the friend who took it the room, when they took it, and how long it waits, also in their inbox", async () => {
    const { invite, accept, challenges } = setup();
    const { id } = await invite();

    const taken = await accept(id, ARJUN);
    const inbox = await challenges.inbox({ playerId: ARJUN.id, now: T0 + 2 * MINUTE });

    expect(taken.challenge).toMatchObject({
      took: true,
      forYou: true,
      acceptedAt: T0 + MINUTE,
      until: T0 + 31 * MINUTE,
      room: { code: "ROOM01", gameId: "chess" },
    });
    expect(inbox).toEqual([taken.challenge]);
    expect(await challenges.inbox({ playerId: ARJUN.id, now: T0 + 31 * MINUTE })).toEqual([]);
  });

  it("keeps a waiting invite for later: it goes back to the sender and the old room stops waiting", async () => {
    const { invite, accept, challenges, emitted } = setup();
    const { id } = await invite();
    await accept(id, ARJUN);
    const at = T0 + MINUTE + INVITE_KEEP_AFTER_MS;

    const tooSoon = await challenges
      .again({ challengeId: id, player: ARJUN, now: at - 1 })
      .catch((err) => err);
    const back = await challenges.again({ challengeId: id, player: ARJUN, now: at });

    expect(tooSoon).toBeInstanceOf(ConflictError);
    expect(tooSoon.details).toEqual({ retryAt: at });
    expect(back).toMatchObject({ own: true, toName: "Riya", state: CHALLENGE_STATES.OPEN, gameId: "chess" });
    expect(back.options).toEqual(CHESS);
    const riyas = await challenges.inbox({ playerId: RIYA.id, now: at + 1 });
    expect(riyas.map(({ id: each, forYou, fromName }) => [each, forYou, fromName])).toEqual([
      [back.id, true, "Arjun"],
    ]);
    expect(await challenges.view({ challengeId: id, viewerId: RIYA.id, now: at + 1 })).toMatchObject({
      until: at,
    });
    expect(emitted.at(-1)).toMatchObject({ event: CHALLENGE_EVENTS.CHANGED, playerIds: [RIYA.id, ARJUN.id] });
    // Kept once: pressing it again finds the room no longer waiting.
    const twice = await challenges.again({ challengeId: id, player: ARJUN, now: at + 2 }).catch((err) => err);
    expect(twice).toBeInstanceOf(GoneError);
  });

  it("invites the sender again after Game filled, and only from the friend it was sent to", async () => {
    const { invite, accept, challenges } = setup();
    const toArjun = await invite({ to: "arjun" });
    const toMeera = await invite({ to: "meera", now: T0 + 1 });
    await accept(toArjun.id, ARJUN);

    await expect(
      challenges.again({ challengeId: toMeera.id, player: ARJUN, now: T0 + 2 * MINUTE }),
    ).rejects.toThrow(ForbiddenError);
    const back = await challenges.again({ challengeId: toMeera.id, player: MEERA, now: T0 + 2 * MINUTE });

    expect(back).toMatchObject({ own: true, toName: "Riya", state: CHALLENGE_STATES.OPEN });
  });

  it("refuses to invite back from an invite still open, declined, or from someone in a block", async () => {
    const { invite, challenges } = setup({ blocked: [[MEERA.id, RIYA.id]] });
    const open = await invite();
    const declined = await invite({ to: "kabir" });
    await challenges.decline({ challengeId: declined.id, playerId: KABIR.id, now: T0 + 1 });
    const blocked = await invite({ to: "meera" });

    const answers = await Promise.all([
      challenges.again({ challengeId: open.id, player: ARJUN, now: T0 + 2 }).catch((err) => err),
      challenges.again({ challengeId: declined.id, player: KABIR, now: T0 + 2 }).catch((err) => err),
      challenges.again({ challengeId: blocked.id, player: MEERA, now: T0 + 2 }).catch((err) => err),
    ]);

    expect(answers.map((err) => [err.constructor, err.details])).toEqual([
      [GoneError, { state: CHALLENGE_STATES.OPEN }],
      [GoneError, { state: CHALLENGE_STATES.DECLINED }],
      [GoneError, { state: CHALLENGE_STATES.EXPIRED }],
    ]);
  });

  it("applies the challenge limits to invites back", async () => {
    const { invite, accept, challenges } = setup();
    // Meera has 3 open invites of her own, so she cannot invite Riya back.
    await invite({ from: MEERA, to: "arjun", gameId: "rps" });
    await invite({ from: MEERA, to: "kabir", gameId: "rps" });
    await invite({ from: MEERA, to: "kabir", gameId: "tictactoe", now: T0 + 11 * MINUTE });
    const toArjun = await invite({ to: "arjun" });
    const toMeera = await invite({ to: "meera", now: T0 + 1 });
    await accept(toArjun.id, ARJUN);

    const refused = await challenges
      .again({ challengeId: toMeera.id, player: MEERA, now: T0 + 12 * MINUTE })
      .catch((err) => err);

    expect(refused).toBeInstanceOf(ConflictError);
    expect(refused.details).toEqual({ reason: CHALLENGE_LIMIT_REASONS.OPEN, limit: 3 });
  });

  it("names the sender to the policy by player id for an invite back, never by anything from the client", async () => {
    const { invite, accept, challenges, resolved } = setup();
    const toArjun = await invite({ to: "arjun" });
    const toMeera = await invite({ to: "meera", now: T0 + 1 });
    await accept(toArjun.id, ARJUN);

    await challenges.again({ challengeId: toMeera.id, player: MEERA, now: T0 + 2 * MINUTE });

    expect(resolved.at(-1)).toEqual({ from: MEERA.id, target: { playerId: RIYA.id } });
  });

  it("shows the sender a blocked invite exactly as one nobody answered", async () => {
    const blockedSetup = setup({ blocked: [[ARJUN.id, RIYA.id]] });
    const quietSetup = setup();
    const blockedInvite = await blockedSetup.invite();
    const unanswered = await quietSetup.invite();

    for (const now of [T0 + MINUTE, T0 + DAY]) {
      const blockedView = await blockedSetup.view(blockedInvite.id, RIYA, now);
      const unansweredView = await quietSetup.view(unanswered.id, RIYA, now);
      expect(JSON.stringify(blockedView)).toBe(JSON.stringify(unansweredView));
    }
    // The friend in the block never hears of it, and their inbox never holds it.
    expect(blockedSetup.emitted.at(-1).playerIds).toEqual([RIYA.id]);
    expect(await blockedSetup.challenges.inbox({ playerId: ARJUN.id, now: T0 + MINUTE })).toEqual([]);
  });
  it("lets a friend take an invite again whose own earlier hold was cut off, the group still theirs", async () => {
    const { invite, accept, accessor } = setup();
    const { id } = await invite();
    await accessor.claim({
      challengeId: id,
      acceptedBy: ARJUN.id,
      acceptedName: "Arjun",
      at: T0,
      staleBefore: T0 - 1,
    });
    await accessor.claimGroup({ groupId: id, by: id, from: "" });

    await expect(accept(id, ARJUN, T0 + MINUTE)).resolves.toMatchObject({ room: { code: "ROOM01" } });
  });

  it("tells nobody about an invite of the group that ended some other way while it was being filled", async () => {
    const later = {};
    const { invite, accept, emitted } = setup({
      wrap: (accessor) => ({
        ...accessor,
        end: async (end) =>
          end.challengeId === later.toMeera.id && end.state === CHALLENGE_STATES.FILLED
            ? false
            : accessor.end(end),
      }),
    });
    const toArjun = await invite();
    later.toMeera = await invite({ to: "meera", now: T0 + 1 });

    await accept(toArjun.id, ARJUN);

    expect(emitted.filter(({ playerIds }) => playerIds?.includes(MEERA.id))).toHaveLength(1);
  });
});
