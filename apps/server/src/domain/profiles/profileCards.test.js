import { describe, expect, it } from "vitest";
import { createProfileAccessor } from "../../data/profileAccessor.js";
import { createInMemoryProfileDao } from "../../testing/inMemoryProfileDao.js";
import { createProfileCards } from "./profileCards.js";

const ADULT = "user_aaaaaaaaaaaaaaaaaaaaaaaa";
const MINOR = "user_bbbbbbbbbbbbbbbbbbbbbbbb";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";
const BOT = "bot_pip_easy";
const STAND_IN = "deleted_00000000-0000-4000-8000-000000000009";
const T0 = Date.UTC(2026, 9, 20, 12);

function setup() {
  let n = 0;
  const dao = createInMemoryProfileDao();
  const profileAccessor = createProfileAccessor({
    profileDao: dao,
    newHandle: () => `${++n}`.padStart(16, "a"),
  });
  const asked = [];
  const ages = {
    adultsAmong: async ({ playerIds }) => {
      asked.push(playerIds);
      return new Set(playerIds.filter((id) => id === ADULT));
    },
  };
  return { profileAccessor, dao, asked, cards: createProfileCards({ profileAccessor, ages }) };
}

describe("profileCards (CC-034)", () => {
  it("answers the avatar a person picked, and nothing for anyone else", async () => {
    const { cards, profileAccessor } = setup();
    await profileAccessor.update({ playerId: GUEST, set: { avatar: "owl" }, at: T0 });

    expect(await cards.avatarOf({ playerId: GUEST })).toBe("owl");
    expect(await cards.avatarOf({ playerId: MINOR })).toBeUndefined();
    expect(await cards.avatarOf({ playerId: BOT })).toBeUndefined();
  });

  it("never answers a stored avatar that is not in the catalogue", async () => {
    const { cards, profileAccessor } = setup();
    await profileAccessor.update({ playerId: GUEST, set: { avatar: "gone-away" }, at: T0 });

    expect(await cards.avatarOf({ playerId: GUEST })).toBeUndefined();
  });

  it("links only adult accounts to their profile, making the handle on the way", async () => {
    const { cards, profileAccessor } = setup();
    await profileAccessor.update({ playerId: MINOR, set: { avatar: "fox" }, at: T0 });
    await profileAccessor.update({ playerId: GUEST, set: { avatar: "owl" }, at: T0 });

    const shown = await cards.cardsFor({ playerIds: [ADULT, MINOR, GUEST, BOT, STAND_IN, ADULT], now: T0 });

    const adult = await profileAccessor.getOrCreate({ playerId: ADULT, at: T0 });
    expect(Object.fromEntries(shown)).toEqual({
      [ADULT]: { profile: adult.handle },
      [MINOR]: { avatar: "fox" },
      [GUEST]: { avatar: "owl" },
    });
  });

  it("gives an adult's card the avatar as well", async () => {
    const { cards, profileAccessor } = setup();
    const made = await profileAccessor.update({ playerId: ADULT, set: { avatar: "crown" }, at: T0 });

    expect((await cards.cardsFor({ playerIds: [ADULT], now: T0 })).get(ADULT)).toEqual({
      avatar: "crown",
      profile: made.handle,
    });
  });

  it("makes no profile for anyone who is not an adult account", async () => {
    const { cards, dao } = setup();

    await cards.cardsFor({ playerIds: [MINOR, GUEST], now: T0 });

    expect(await dao.findByPlayers([MINOR, GUEST])).toEqual([]);
  });

  it("asks about nobody when there is no person", async () => {
    const { cards, asked } = setup();

    expect(await cards.cardsFor({ playerIds: [BOT, STAND_IN], now: T0 })).toEqual(new Map());
    expect(asked).toEqual([]);
  });
});
