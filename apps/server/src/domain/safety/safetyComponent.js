import { isAccountId, isGuestId } from "../../models/identity.js";
import { assertFunction } from "../../utils/assert.js";
import { agePolicyFor, audienceOf } from "./agePolicy.js";

/** The kind of player an id belongs to, for `audienceOf`. */
const kindOf = (playerId) => {
  if (isAccountId(playerId)) return "account";
  if (isGuestId(playerId)) return "guest";
  return "other";
};

/**
 * The one place a feature learns what a player may do socially (CC-152). It reads the accounts' age groups once
 * for a list of players and answers each player's age policy (agePolicy.js). Features take this component and read
 * the policy's fields. None of them works out an age, so the rules are in one place and a new feature cannot miss
 * one.
 *
 * @param {{
 *   ages: { ageGroupsOf: (query: { playerIds: string[], now: number }) => Promise<ReadonlyMap<string, string>> },
 * }} deps  `ages` is the account component: the age group of each account it is asked about
 */
export function createSafetyComponent({ ages }) {
  assertFunction(ages?.ageGroupsOf, "ages.ageGroupsOf");

  /**
   * The policy of each of `playerIds`, guests and computer players included. An account whose age the account
   * component does not give, such as a deleted one, is of unknown age, so it gets a minor's policy.
   *
   * @param {{ playerIds: ReadonlyArray<string>, now: number }} query
   * @returns {Promise<ReadonlyMap<string, import("./agePolicy.js").AgePolicy>>}
   */
  async function policiesFor({ playerIds, now }) {
    const players = [...new Set(playerIds)];
    const accounts = players.filter(isAccountId);
    const groups = accounts.length === 0 ? new Map() : await ages.ageGroupsOf({ playerIds: accounts, now });
    return new Map(
      players.map((playerId) => [
        playerId,
        agePolicyFor(audienceOf({ kind: kindOf(playerId), ageGroup: groups.get(playerId) })),
      ]),
    );
  }

  return Object.freeze({
    policiesFor,

    /**
     * The policy of one player.
     *
     * @param {{ playerId: string, now: number }} query
     */
    async policyFor({ playerId, now }) {
      return (await policiesFor({ playerIds: [playerId], now })).get(playerId);
    },
  });
}
