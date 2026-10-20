import {
  DEFAULT_PROFILE_VISIBILITY,
  GAME_IDS,
  HIDDEN_PLAYER_NAME,
  isAvatarId,
  PROFILE_VISIBILITY,
} from "@classicade/shared";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors.js";
import { canPickAvatar } from "./avatarRules.js";

const VISIBILITIES = new Set(Object.values(PROFILE_VISIBILITY));

/** The one answer for a handle nobody has and a deleted player's, so a lookup can never tell them apart (OWASP IDOR). */
const notFound = (cause) => new NotFoundError("No such player", cause === undefined ? {} : { cause });

const avatarField = (profile) => (isAvatarId(profile.avatar) ? { avatar: profile.avatar } : {});
const visibilityOf = (profile) => profile.visibility ?? DEFAULT_PROFILE_VISIBILITY;

/**
 * Public profiles and avatars (CC-034, ADR-065).
 *
 * 1. Every person has a profile, made the first time it is needed, with a random handle as its address.
 * 2. Anyone, a guest too, picks an avatar from the catalogue for their own profile.
 * 3. Only an adult account's profile can be public, and only when its owner made it public. It starts private.
 * 4. A profile is looked up by its handle only. A handle nobody has and a deleted player's get the same "not
 *    found". Anyone not surely an adult, guests included, is "Hidden player" with their avatar and nothing else.
 * 5. Blocks are not read. A blocked pair sees exactly what a signed-out visitor sees, because a refusal that a
 *    visitor does not get would tell the blocked player they were blocked (ADR-053). A profile shows nothing a
 *    visitor cannot see anyway.
 *
 * @param {{
 *   profileAccessor: ReturnType<typeof import("../../data/profileAccessor.js").createProfileAccessor>,
 *   safety: Pick<ReturnType<typeof import("../safety/safetyComponent.js").createSafetyComponent>, "policyFor">,  the
 *     age policy: `publicProfile` says who may go public, `profileLink` whose profile shows a name (CC-152)
 *   accounts: { profileOf: (query: { playerId: string, now: number }) => Promise<Readonly<{ username: string }>> },
 *   progress: { getProgress: (playerId: string) => Promise<Readonly<{ level: number, matchesPlayed: number, wins: number }>> },
 *   ratings: { ratingsOf: (query: { gameId: string, playerIds: ReadonlyArray<string>, matchId: string }) => Promise<ReadonlyArray<Readonly<{ rating: number, games: number, provisional: boolean }>>> },
 * }} deps  `accounts` gives an adult's username, `progress` their level and games, `ratings` their chess rating
 *   (CC-042)
 */
export function createProfileComponent({ profileAccessor, safety, accounts, progress, ratings }) {
  assertDefined(profileAccessor, "profileAccessor");
  assertFunction(safety?.policyFor, "safety.policyFor");
  assertFunction(accounts?.profileOf, "accounts.profileOf");
  assertFunction(progress?.getProgress, "progress.getProgress");
  assertFunction(ratings?.ratingsOf, "ratings.ratingsOf");

  /** The player's age policy (CC-152). Guests and anyone not surely an adult get the minor's (ADR-028.1). */
  const policyOf = (playerId, now) => safety.policyFor({ playerId, now });

  /** The player's own view of their profile. */
  async function ownView(profile, now) {
    return Object.freeze({
      handle: profile.handle,
      ...avatarField(profile),
      visibility: visibilityOf(profile),
      canBePublic: (await policyOf(profile.playerId, now)).publicProfile,
    });
  }

  /** The chess rating as the profile shows it, from the same view rooms show (CC-042). */
  async function chessOf(playerId) {
    const [rating] = await ratings.ratingsOf({ gameId: GAME_IDS.CHESS, playerIds: [playerId], matchId: "" });
    return { rating: rating.rating, provisional: rating.provisional, games: rating.games };
  }

  /** What everyone may see of an adult's public profile: no dates, no streaks, no history, no ids. */
  async function publicStats(playerId) {
    const { level, matchesPlayed, wins } = await progress.getProgress(playerId);
    return { level, stats: { gamesPlayed: matchesPlayed, wins }, chess: await chessOf(playerId) };
  }

  /** The adult account's username, or not found when the account is gone. */
  async function usernameOf(playerId, now) {
    try {
      return (await accounts.profileOf({ playerId, now })).username;
    } catch (err) {
      if (err instanceof NotFoundError) throw notFound(err);
      throw err;
    }
  }

  return Object.freeze({
    /**
     * The player's own profile: its handle, their avatar, the visibility they chose (private until they choose) and
     * whether they may make it public at all.
     *
     * @param {{ player: Readonly<import("../../models/identity.js").Identity>, now: number }} input
     */
    async ownProfile({ player, now }) {
      return ownView(await profileAccessor.getOrCreate({ playerId: player.id, at: now }), now);
    },

    /**
     * Sets the player's avatar.
     *
     * @param {{ player: Readonly<import("../../models/identity.js").Identity>, avatar: unknown, now: number }} input
     * @throws {ValidationError} for anything the player cannot pick, with `details.field` "avatar"
     */
    async setAvatar({ player, avatar, now }) {
      if (!canPickAvatar(avatar)) {
        throw new ValidationError("Pick one of the avatars", { details: { field: "avatar" } });
      }
      const profile = await profileAccessor.update({
        playerId: player.id,
        set: { avatar: /** @type {string} */ (avatar) },
        at: now,
      });
      return ownView(profile, now);
    },

    /**
     * Makes the player's profile public or private. Only an adult account may make it public. Anyone may make it
     * private.
     *
     * @param {{ player: Readonly<import("../../models/identity.js").Identity>, visibility: unknown, now: number }} input
     * @throws {ValidationError} for anything but "public" or "private"
     * @throws {ForbiddenError} when someone not surely an adult asks for public
     */
    async setVisibility({ player, visibility, now }) {
      if (typeof visibility !== "string" || !VISIBILITIES.has(visibility)) {
        throw new ValidationError("Choose public or private", { details: { field: "visibility" } });
      }
      if (visibility === PROFILE_VISIBILITY.PUBLIC && !(await policyOf(player.id, now)).publicProfile) {
        throw new ForbiddenError("Only players aged 18 or over can make their profile public");
      }
      return ownView(
        await profileAccessor.update({ playerId: player.id, set: { visibility }, at: now }),
        now,
      );
    },

    /**
     * What a viewer sees at a handle. Checked in this order, on every read:
     *
     * 1. No such handle, or a deleted account: not found, both alike. A block changes nothing (point 5 above).
     * 2. Not surely an adult: `{ hidden: true }` as "Hidden player" with the avatar they picked, nothing else.
     *    Avatars come from our own set and identify nobody (owner, ADR-065).
     * 3. A private adult profile: the username and the avatar, `private: true`.
     * 4. A public adult profile: also the level, games played and won, and the chess rating.
     *
     * `own` is true when the viewer looks at their own profile, which shows exactly what others see.
     *
     * @param {{ handle: string, viewerId: string, now: number }} query  `viewerId` is "" for a visitor
     * @throws {NotFoundError} as in point 1
     */
    async publicView({ handle, viewerId, now }) {
      let profile;
      try {
        profile = await profileAccessor.getByHandle(handle);
      } catch (err) {
        if (err instanceof NotFoundError) throw notFound(err);
        throw err;
      }
      const { playerId } = profile;
      const own = viewerId !== "" && viewerId === playerId;
      const base = { handle, ...(own && { own: true }) };
      if (!(await policyOf(playerId, now)).profileLink) {
        return Object.freeze({
          ...base,
          hidden: true,
          displayName: HIDDEN_PLAYER_NAME,
          ...avatarField(profile),
        });
      }
      const shown = { ...base, displayName: await usernameOf(playerId, now), ...avatarField(profile) };
      if (visibilityOf(profile) !== PROFILE_VISIBILITY.PUBLIC) {
        return Object.freeze({ ...shown, private: true });
      }
      return Object.freeze({ ...shown, ...(await publicStats(playerId)) });
    },

    /**
     * A guest just signed in (ADR-014): the account keeps its own profile and avatar, and takes the guest's avatar
     * when it has none. An account without a profile takes the guest's whole profile, handle included. Otherwise
     * the guest's profile is deleted, so its handle leads nowhere. Running it twice changes nothing more.
     *
     * @param {{ from: string, to: Readonly<{ id: string }>, now: number }} transfer
     * @returns {Promise<{ moved: { profiles: number } }>}
     */
    async transferPlayer({ from, to, now }) {
      const found = await profileAccessor.findMany([from, to.id]);
      const guest = found.get(from);
      if (guest === undefined) {
        return { moved: { profiles: 0 } };
      }
      if (!found.has(to.id)) {
        try {
          return { moved: { profiles: Number(await profileAccessor.rename({ from, to: to.id })) } };
        } catch (err) {
          // The account made its own profile a moment ago: carry on as if it had one before.
          if (!(err instanceof ConflictError)) throw err;
        }
      }
      const account = await profileAccessor.getOrCreate({ playerId: to.id, at: now });
      if (account.avatar === undefined && guest.avatar !== undefined) {
        await profileAccessor.update({ playerId: to.id, set: { avatar: guest.avatar }, at: now });
      }
      await profileAccessor.remove(from);
      return { moved: { profiles: 1 } };
    },

    /**
     * The player's profile for their data export (CC-035): the handle, the avatar and the visibility.
     *
     * @param {{ playerId: string }} query
     */
    async exportPlayer({ playerId }) {
      const profile = (await profileAccessor.findMany([playerId])).get(playerId);
      if (profile === undefined) return {};
      return { handle: profile.handle, ...avatarField(profile), visibility: visibilityOf(profile) };
    },

    /**
     * Deletes the player's profile (CC-035), so its handle leads nowhere. Running it twice changes nothing.
     *
     * @param {{ playerId: string }} input
     * @returns {Promise<{ erased: { profiles: number } }>}
     */
    erasePlayer: async ({ playerId }) => ({ erased: { profiles: await profileAccessor.remove(playerId) } }),
  });
}
