import { isAvatarId } from "@classicade/shared";
import { isAccountId, isGuestId } from "../../models/identity.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";

/** A person has a profile. Computer characters and deleted players' stand-ins never do. */
const isPerson = (playerId) => isAccountId(playerId) || isGuestId(playerId);

/** The avatar a profile holds, only while it is in the catalogue. */
const avatarOf = (profile) =>
  profile !== undefined && isAvatarId(profile.avatar) ? { avatar: profile.avatar } : {};

/**
 * What rooms, the boards and match history show beside a name (CC-034, ADR-065): the avatar a person picked, and the
 * handle of their profile when they are an adult account. Only an adult's profile can ever be public, so nobody
 * else is ever linked to, and a handle never joins up the anonymous rows of a minor. Nothing here names a player by
 * id: the caller puts each card beside the name it already shows.
 *
 * @param {{
 *   profileAccessor: Pick<ReturnType<typeof import("../../data/profileAccessor.js").createProfileAccessor>, "findMany" | "getOrCreateMany">,
 *   ages: { adultsAmong: (query: { playerIds: string[], now: number }) => Promise<ReadonlySet<string>> },
 * }} deps
 */
export function createProfileCards({ profileAccessor, ages }) {
  assertDefined(profileAccessor, "profileAccessor");
  assertFunction(ages?.adultsAmong, "ages.adultsAmong");

  return Object.freeze({
    /**
     * The avatar a person picked, or nothing. Rooms keep it on the seat when the person sits down.
     *
     * @param {{ playerId: string }} query
     * @returns {Promise<string | undefined>}
     */
    async avatarOf({ playerId }) {
      if (!isPerson(playerId)) return undefined;
      return avatarOf((await profileAccessor.findMany([playerId])).get(playerId)).avatar;
    },

    /**
     * A card for each person among `playerIds`: `{ avatar? , profile? }`, where `profile` is the handle of an adult
     * account's profile, made now if it had none. Anyone else among them has no card.
     *
     * @param {{ playerIds: ReadonlyArray<string>, now: number }} query
     * @returns {Promise<ReadonlyMap<string, Readonly<{ avatar?: string, profile?: string }>>>}
     */
    async cardsFor({ playerIds, now }) {
      const people = [...new Set(playerIds.filter(isPerson))];
      if (people.length === 0) return new Map();
      const adults = [...(await ages.adultsAmong({ playerIds: people, now }))];
      const linked =
        adults.length === 0
          ? new Map()
          : await profileAccessor.getOrCreateMany({ playerIds: adults, at: now });
      const found = await profileAccessor.findMany(people.filter((id) => !linked.has(id)));
      return new Map(
        people.map((playerId) => {
          const profile = linked.get(playerId) ?? found.get(playerId);
          const handle = linked.has(playerId) ? { profile: profile.handle } : {};
          return [playerId, Object.freeze({ ...avatarOf(profile), ...handle })];
        }),
      );
    },
  });
}
