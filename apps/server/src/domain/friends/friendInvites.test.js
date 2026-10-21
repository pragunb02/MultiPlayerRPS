import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { flagPaths } from "../../testing/flagPaths.js";
import { ForbiddenError, NotFoundError } from "../../utils/errors.js";
import { CHALLENGE_EVENTS } from "../challenges/challengeComponent.js";
import { FRIEND_EVENTS } from "./friendComponent.js";
import { createFriendInvites } from "./friendInvites.js";

const RIYA = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" });
const ARJUN_ID = "user_ffffffffffffffffffffffff";
const T0 = Date.UTC(2026, 9, 20, 12);

/** Arjun is Riya's friend, at handle "arjunhandle00000". Anyone else is not found; a guest is refused. */
function setup(on) {
  const asked = [];
  const successes = [];
  const warnings = [];
  const ended = [];
  const events = new EventEmitter();
  const invites = createFriendInvites({
    friends: {
      inviteeOf: async ({ playerId, target }) => {
        if (playerId.startsWith("guest_")) throw new ForbiddenError("Save your progress to add friends");
        if (target.handle === "arjunhandle00000" || target.playerId === ARJUN_ID) {
          return { id: ARJUN_ID, displayName: "Arjun" };
        }
        if (target.handle === "brokenhandle0000") throw new Error("database down");
        throw new NotFoundError("No such friend");
      },
    },
    flags: {
      isOn: async (name, player) => {
        asked.push([name, player]);
        return on;
      },
      recordSuccess: async (name, player) => {
        if (player.id === "user_failing000000000000000") throw new Error("counts down");
        successes.push([name, player]);
      },
    },
    events,
    logger: { warn: ({ err }, message) => warnings.push([err.message, message]) },
    challenges: () => ({
      endInvitesBetween: async (pair) => {
        if (pair.a === "user_failing000000000000000") throw new Error("database down");
        ended.push(pair);
        return 1;
      },
    }),
  });
  return { invites, events, asked, successes, warnings, ended };
}

describe("friend invites (CC-052 part 2)", () => {
  it("needs the friends, the flags and the events", () => {
    expect(() => createFriendInvites({})).toThrow(TypeError);
  });

  flagPaths("friend_invites", (on) => {
    it("names a friend by handle, and answers one 404 for everyone else", async () => {
      const { invites, asked } = setup(on);
      const resolve = (target, from = RIYA) => invites.resolve({ from, target, now: T0 });
      const guest = { kind: "guest", id: "guest_00000000-0000-4000-8000-000000000001", displayName: "G" };

      if (on) {
        await expect(resolve({ handle: "arjunhandle00000" })).resolves.toEqual({
          id: ARJUN_ID,
          displayName: "Arjun",
        });
        await expect(resolve({ playerId: ARJUN_ID })).resolves.toMatchObject({ id: ARJUN_ID });
      }
      const refusals = await Promise.all([
        resolve({ handle: "strangerhandle00" }).catch((err) => err),
        resolve({ handle: "arjunhandle00000" }, guest).catch((err) => err),
        ...(on ? [] : [resolve({ handle: "arjunhandle00000" }).catch((err) => err)]),
      ]);
      for (const refusal of refusals) {
        expect(refusal).toBeInstanceOf(NotFoundError);
        expect(refusal.message).toBe("We couldn't find that player");
      }
      expect(asked[0]).toEqual(["friend_invites", { id: RIYA.id, kind: "user", admin: false }]);
    });

    it("lets a failure that is not a refusal through", async () => {
      const { invites } = setup(on);
      const failed = await invites
        .resolve({ from: RIYA, target: { handle: "brokenhandle0000" }, now: T0 })
        .catch((err) => err);

      expect(failed.message).toBe(on ? "database down" : "We couldn't find that player");
    });

    it("counts the flag's success when a friend accepts an invite", async () => {
      const { events, successes, warnings } = setup(on);

      events.emit(CHALLENGE_EVENTS.ACCEPTED, { challenge: { fromId: RIYA.id, toId: ARJUN_ID } });
      events.emit(CHALLENGE_EVENTS.ACCEPTED, { challenge: { fromId: RIYA.id, toId: "" } });
      events.emit(CHALLENGE_EVENTS.ACCEPTED, {
        challenge: { fromId: "user_failing000000000000000", toId: ARJUN_ID },
      });
      await new Promise((resolve) => setImmediate(resolve));

      // The success is counted on the sender's side, which the server works out, so a link counts nothing.
      expect(successes).toEqual([["friend_invites", { id: RIYA.id, kind: "user", admin: false }]]);
      expect(warnings).toEqual([["counts down", "counting an invite's success failed"]]);
    });
  });

  it("ends the open invites between two players whose friendship ended (review of #167)", async () => {
    const { events, ended, warnings } = setup(true);

    events.emit(FRIEND_EVENTS.ENDED, { a: RIYA.id, b: ARJUN_ID, now: T0 });
    events.emit(FRIEND_EVENTS.ENDED, { a: "user_failing000000000000000", b: ARJUN_ID, now: T0 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(ended).toEqual([{ a: RIYA.id, b: ARJUN_ID, now: T0 }]);
    expect(warnings).toEqual([["database down", "ending the invites of a friendship failed"]]);
  });
});
