import { describe, expect, it } from "vitest";
import { createProfileAccessor } from "../../data/profileAccessor.js";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { createInMemoryProfileDao } from "../../testing/inMemoryProfileDao.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors.js";
import { createProfileComponent } from "./profileComponent.js";

// CC-034, ADR-065. Riya is an adult account, Kabir a minor's account, Meena an account of unknown age, and the
// guest has no age at all.
const RIYA = Object.freeze({ kind: "user", id: "user_aaaaaaaaaaaaaaaaaaaaaaaa", displayName: "RiyaTest" });
const KABIR = Object.freeze({ kind: "user", id: "user_bbbbbbbbbbbbbbbbbbbbbbbb", displayName: "KabirTest" });
const MEENA = Object.freeze({ kind: "user", id: "user_cccccccccccccccccccccccc", displayName: "MeenaTest" });
const ARJUN = Object.freeze({ kind: "user", id: "user_dddddddddddddddddddddddd", displayName: "ArjunTest" });
const GUEST = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-000000000001",
  displayName: "Guest-T001",
});
const T0 = Date.UTC(2026, 9, 20, 12);
const ADULTS = new Set([RIYA.id, ARJUN.id]);
const USERNAMES = new Map([RIYA, KABIR, MEENA, ARJUN].map((p) => [p.id, p.displayName]));

/** Every string anywhere in a value. */
const stringsIn = (value) =>
  typeof value === "string"
    ? [value]
    : value !== null && typeof value === "object"
      ? [...Object.keys(value), ...Object.values(value)].flatMap(stringsIn)
      : [];

function setup({ deleted = [] } = {}) {
  let n = 0;
  const profileAccessor = createProfileAccessor({
    profileDao: createInMemoryProfileDao(),
    newHandle: () => `${++n}`.padStart(16, "h"),
  });
  const component = createProfileComponent({
    profileAccessor,
    ages: { adultsAmong: async ({ playerIds }) => new Set(playerIds.filter((id) => ADULTS.has(id))) },
    accounts: {
      profileOf: async ({ playerId }) => {
        if (deleted.includes(playerId)) throw new NotFoundError("Account not found");
        return { username: USERNAMES.get(playerId) };
      },
    },
    progress: { getProgress: async () => ({ level: 7, matchesPlayed: 31, wins: 18, xp: 900, losses: 9 }) },
    ratings: {
      ratingsOf: async ({ gameId, playerIds, matchId }) => {
        expect({ gameId, matchId }).toEqual({ gameId: "chess", matchId: "" });
        return [{ playerId: playerIds[0], rating: 1532, deviation: 80, games: 14, provisional: false }];
      },
    },
  });
  const handleOf = async (player) => (await component.ownProfile({ player, now: T0 })).handle;
  return { component, profileAccessor, handleOf };
}

describe("profileComponent: your own profile (CC-034)", () => {
  it("gives every person a handle the first time, private until they choose", async () => {
    const { component } = setup();

    const own = await component.ownProfile({ player: GUEST, now: T0 });

    expect(own).toEqual({ handle: "hhhhhhhhhhhhhhh1", visibility: "private", canBePublic: false });
    expect(await component.ownProfile({ player: GUEST, now: T0 + 1 })).toEqual(own);
  });

  it("says that only an adult account may make it public", async () => {
    const { component } = setup();

    for (const [player, can] of [
      [RIYA, true],
      [KABIR, false],
      [MEENA, false],
      [GUEST, false],
    ]) {
      expect((await component.ownProfile({ player, now: T0 })).canBePublic).toBe(can);
    }
  });

  it("lets anyone, a guest too, pick an avatar from the catalogue", async () => {
    const { component } = setup();

    expect(await component.setAvatar({ player: GUEST, avatar: "owl", now: T0 })).toMatchObject({
      avatar: "owl",
    });
    expect(await component.setAvatar({ player: GUEST, avatar: "fox", now: T0 + 1 })).toMatchObject({
      avatar: "fox",
    });
  });

  it.each([["unknown"], [""], [7], [undefined], [{ id: "owl" }], ["__proto__"]])(
    "refuses %j as an avatar",
    async (avatar) => {
      const { component } = setup();

      const error = await component.setAvatar({ player: GUEST, avatar, now: T0 }).catch((err) => err);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.details).toEqual({ field: "avatar" });
    },
  );

  it("lets an adult make their profile public and private again", async () => {
    const { component } = setup();

    expect(await component.setVisibility({ player: RIYA, visibility: "public", now: T0 })).toMatchObject({
      visibility: "public",
    });
    expect(await component.setVisibility({ player: RIYA, visibility: "private", now: T0 })).toMatchObject({
      visibility: "private",
    });
  });

  it.each([[KABIR], [MEENA], [GUEST]])("never lets %o make it public, but always private", async (player) => {
    const { component } = setup();

    await expect(component.setVisibility({ player, visibility: "public", now: T0 })).rejects.toThrow(
      ForbiddenError,
    );
    expect(await component.setVisibility({ player, visibility: "private", now: T0 })).toMatchObject({
      visibility: "private",
    });
  });

  it.each([["everyone"], ["PUBLIC"], [true], [undefined]])(
    "refuses %j as a visibility",
    async (visibility) => {
      const { component } = setup();

      await expect(component.setVisibility({ player: RIYA, visibility, now: T0 })).rejects.toThrow(
        ValidationError,
      );
    },
  );
});

describe("profileComponent: what a viewer sees at a handle (CC-034)", () => {
  it("shows an adult's public profile: name, avatar, level, games, wins and chess rating, nothing else", async () => {
    const { component, handleOf } = setup();
    const handle = await handleOf(RIYA);
    await component.setAvatar({ player: RIYA, avatar: "crown", now: T0 });
    await component.setVisibility({ player: RIYA, visibility: "public", now: T0 });

    const seen = await component.publicView({ handle, viewerId: "", now: T0 });

    expect(seen).toEqual({
      handle,
      displayName: "RiyaTest",
      avatar: "crown",
      level: 7,
      stats: { gamesPlayed: 31, wins: 18 },
      chess: { rating: 1532, provisional: false, games: 14 },
    });
  });

  it("keeps an adult's profile private until they make it public", async () => {
    const { component, handleOf } = setup();
    const handle = await handleOf(RIYA);
    await component.setAvatar({ player: RIYA, avatar: "crown", now: T0 });

    expect(await component.publicView({ handle, viewerId: ARJUN.id, now: T0 })).toEqual({
      handle,
      displayName: "RiyaTest",
      avatar: "crown",
      private: true,
    });
  });

  it.each([
    ["a minor", KABIR],
    ["an account of unknown age", MEENA],
    ["a guest", GUEST],
  ])(
    "shows %s as Hidden player, with the avatar they picked and no stats (owner, ADR-065)",
    async (_, player) => {
      const { component, handleOf } = setup();
      const handle = await handleOf(player);
      await component.setAvatar({ player, avatar: "fox", now: T0 });

      expect(await component.publicView({ handle, viewerId: RIYA.id, now: T0 })).toEqual({
        handle,
        hidden: true,
        displayName: "Hidden player",
        avatar: "fox",
      });
    },
  );

  it("answers the same not found for a handle nobody has and a deleted account", async () => {
    const { component } = setup({ deleted: [KABIR.id] });
    ADULTS.add(KABIR.id);
    const kabir = (await component.ownProfile({ player: KABIR, now: T0 })).handle;

    try {
      const refusals = await Promise.all(
        [
          { handle: "nnnnnnnnnnnnnnnn", viewerId: "" },
          { handle: kabir, viewerId: "" },
        ].map((query) => component.publicView({ ...query, now: T0 }).catch((err) => err)),
      );

      for (const refusal of refusals) {
        expect(refusal).toBeInstanceOf(NotFoundError);
        expect(refusal.message).toBe("No such player");
        expect(refusal.details).toEqual({});
      }
    } finally {
      ADULTS.delete(KABIR.id);
    }
  });

  it("shows a blocked pair, both ways, exactly what a visitor sees, so a block cannot be told apart (ADR-053)", async () => {
    // A 404 for a blocked viewer would say "you are blocked": the same handle answers a signed-out visitor. So
    // the component never reads blocks at all, whoever blocked whom.
    const { component, handleOf } = setup();
    const riya = await handleOf(RIYA);
    const arjun = await handleOf(ARJUN);
    const kabir = await handleOf(KABIR);
    await component.setVisibility({ player: RIYA, visibility: "public", now: T0 });

    for (const [handle, viewerId] of [
      [riya, ARJUN.id],
      [arjun, RIYA.id],
      [kabir, RIYA.id],
    ]) {
      expect(await component.publicView({ handle, viewerId, now: T0 })).toEqual(
        await component.publicView({ handle, viewerId: "", now: T0 }),
      );
    }
  });

  it("shows a visitor and anyone unblocked the same profile", async () => {
    const { component, handleOf } = setup();
    const handle = await handleOf(RIYA);

    const visitor = await component.publicView({ handle, viewerId: "", now: T0 });
    expect(await component.publicView({ handle, viewerId: MEENA.id, now: T0 })).toEqual(visitor);
  });

  it("shows a player their own profile as others see it, marked as their own", async () => {
    const { component, handleOf } = setup();
    const handle = await handleOf(KABIR);

    expect(await component.publicView({ handle, viewerId: KABIR.id, now: T0 })).toEqual({
      handle,
      own: true,
      hidden: true,
      displayName: "Hidden player",
    });
  });

  it("passes a failure to read the account through", async () => {
    const { handleOf, profileAccessor } = setup();
    const handle = await handleOf(RIYA);
    const broken = createProfileComponent({
      profileAccessor,
      ages: { adultsAmong: async () => new Set([RIYA.id]) },
      accounts: { profileOf: async () => Promise.reject(new Error("database down")) },
      progress: { getProgress: async () => ({}) },
      ratings: { ratingsOf: async () => [] },
    });

    await expect(broken.publicView({ handle, viewerId: "", now: T0 })).rejects.toThrow("database down");
  });

  it("passes a failure to read the handle through", async () => {
    const broken = createProfileComponent({
      profileAccessor: { getByHandle: async () => Promise.reject(new Error("database down")) },
      ages: { adultsAmong: async () => new Set() },
      accounts: { profileOf: async () => ({}) },
      progress: { getProgress: async () => ({}) },
      ratings: { ratingsOf: async () => [] },
    });

    await expect(broken.publicView({ handle: "hhhhhhhhhhhhhhh1", viewerId: "", now: T0 })).rejects.toThrow(
      "database down",
    );
  });

  it("never sends anything shaped like a player id, in any answer", async () => {
    const { component, handleOf } = setup();
    const answers = [];
    for (const player of [RIYA, KABIR, MEENA, GUEST]) {
      const handle = await handleOf(player);
      answers.push(await component.ownProfile({ player, now: T0 }));
      answers.push(await component.setAvatar({ player, avatar: "owl", now: T0 }));
      answers.push(await component.setVisibility({ player, visibility: "private", now: T0 }));
      answers.push(await component.publicView({ handle, viewerId: "", now: T0 }));
      answers.push(await component.publicView({ handle, viewerId: player.id, now: T0 }));
      answers.push(await component.exportPlayer({ playerId: player.id }));
    }
    await component.setVisibility({ player: RIYA, visibility: "public", now: T0 });
    answers.push(await component.publicView({ handle: await handleOf(RIYA), viewerId: "", now: T0 }));

    expect(stringsIn(answers).filter(hasPlayerIdShape)).toEqual([]);
  });
});

describe("profileComponent: who a report from a profile names (CC-044, ADR-071.1)", () => {
  it("answers the adult account behind a handle, public or private, with the username a viewer sees", async () => {
    const { component, handleOf } = setup();
    const handle = await handleOf(RIYA);

    expect(await component.personByHandle({ handle, viewerId: ARJUN.id, now: T0 })).toEqual({
      playerId: RIYA.id,
      displayName: "RiyaTest",
    });
  });

  it("answers not found for a hidden profile, a guest's, a deleted account's and a handle nobody has", async () => {
    const { component, handleOf } = setup({ deleted: [ARJUN.id] });
    const handles = [await handleOf(KABIR), await handleOf(GUEST), await handleOf(ARJUN), "zzzzzzzzzzzzzzzz"];

    for (const handle of handles) {
      await expect(component.personByHandle({ handle, viewerId: RIYA.id, now: T0 })).rejects.toMatchObject({
        message: "No such player",
      });
    }
  });
});

describe("profileComponent: a guest signs in (ADR-014)", () => {
  it("gives the whole profile to an account that has none, handle and avatar included", async () => {
    const { component, handleOf } = setup();
    const guestHandle = await handleOf(GUEST);
    await component.setAvatar({ player: GUEST, avatar: "owl", now: T0 });

    expect(await component.transferPlayer({ from: GUEST.id, to: RIYA, now: T0 })).toEqual({
      moved: { profiles: 1 },
    });
    expect(await component.ownProfile({ player: RIYA, now: T0 })).toMatchObject({
      handle: guestHandle,
      avatar: "owl",
    });
    expect(await component.transferPlayer({ from: GUEST.id, to: RIYA, now: T0 })).toEqual({
      moved: { profiles: 0 },
    });
  });

  it("keeps the account's own avatar and handle, and the guest's handle leads nowhere", async () => {
    const { component, handleOf } = setup();
    const guestHandle = await handleOf(GUEST);
    await component.setAvatar({ player: GUEST, avatar: "owl", now: T0 });
    const own = await component.setAvatar({ player: RIYA, avatar: "crown", now: T0 });

    await component.transferPlayer({ from: GUEST.id, to: RIYA, now: T0 });

    expect(await component.ownProfile({ player: RIYA, now: T0 })).toMatchObject({
      handle: own.handle,
      avatar: "crown",
    });
    await expect(component.publicView({ handle: guestHandle, viewerId: "", now: T0 })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("takes the guest's avatar when the account has a profile but no avatar", async () => {
    const { component, handleOf } = setup();
    await handleOf(RIYA);
    await component.setAvatar({ player: GUEST, avatar: "owl", now: T0 });

    await component.transferPlayer({ from: GUEST.id, to: RIYA, now: T0 });

    expect((await component.ownProfile({ player: RIYA, now: T0 })).avatar).toBe("owl");
  });

  it("keeps the account's profile without an avatar when the guest had none either", async () => {
    const { component, handleOf } = setup();
    await handleOf(RIYA);
    await handleOf(GUEST);

    await component.transferPlayer({ from: GUEST.id, to: RIYA, now: T0 });

    expect(await component.ownProfile({ player: RIYA, now: T0 })).not.toHaveProperty("avatar");
  });

  it("carries on when the account made its own profile a moment before the move", async () => {
    const { component, handleOf, profileAccessor } = setup();
    await handleOf(GUEST);
    await component.setAvatar({ player: GUEST, avatar: "owl", now: T0 });
    const racing = createProfileComponent({
      profileAccessor: {
        ...profileAccessor,
        async rename(transfer) {
          await profileAccessor.getOrCreate({ playerId: transfer.to, at: T0 });
          return profileAccessor.rename(transfer);
        },
      },
      ages: { adultsAmong: async () => new Set() },
      accounts: { profileOf: async () => ({}) },
      progress: { getProgress: async () => ({}) },
      ratings: { ratingsOf: async () => [] },
    });

    expect(await racing.transferPlayer({ from: GUEST.id, to: RIYA, now: T0 })).toEqual({
      moved: { profiles: 1 },
    });
    expect((await component.ownProfile({ player: RIYA, now: T0 })).avatar).toBe("owl");
  });

  it("passes other failures of the move through", async () => {
    const { handleOf, profileAccessor } = setup();
    await handleOf(GUEST);
    const broken = createProfileComponent({
      profileAccessor: { ...profileAccessor, rename: async () => Promise.reject(new Error("database down")) },
      ages: { adultsAmong: async () => new Set() },
      accounts: { profileOf: async () => ({}) },
      progress: { getProgress: async () => ({}) },
      ratings: { ratingsOf: async () => [] },
    });

    await expect(broken.transferPlayer({ from: GUEST.id, to: RIYA, now: T0 })).rejects.toThrow(
      "database down",
    );
  });
});

describe("profileComponent: export and deletion (CC-035)", () => {
  it("exports the handle, the avatar and the visibility, and nothing when there is no profile", async () => {
    const { component, handleOf } = setup();
    const handle = await handleOf(RIYA);
    await component.setAvatar({ player: RIYA, avatar: "crown", now: T0 });

    expect(await component.exportPlayer({ playerId: RIYA.id })).toEqual({
      handle,
      avatar: "crown",
      visibility: "private",
    });
    expect(await component.exportPlayer({ playerId: ARJUN.id })).toEqual({});
  });

  it("deletes the profile, so the handle leads nowhere, and changes nothing the second time", async () => {
    const { component, handleOf } = setup();
    const handle = await handleOf(RIYA);

    expect(await component.erasePlayer({ playerId: RIYA.id })).toEqual({ erased: { profiles: 1 } });
    expect(await component.erasePlayer({ playerId: RIYA.id })).toEqual({ erased: { profiles: 0 } });
    await expect(component.publicView({ handle, viewerId: "", now: T0 })).rejects.toThrow(NotFoundError);
  });
});
