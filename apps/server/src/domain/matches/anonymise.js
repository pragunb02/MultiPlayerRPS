import { renamePlayer } from "@classicade/games";

/** Takes the former guest id out of one credit entry of the stand-in, keeping everything else it says. */
const withoutGuest = (entries, standId) =>
  entries.map(({ withdrawnFrom, ...entry }) =>
    entry.playerId === standId ? entry : { ...entry, ...(withdrawnFrom !== undefined && { withdrawnFrom }) },
  );

/**
 * A match with a deleted player replaced by a stand-in (CC-035). Their id becomes the stand-in's everywhere in the
 * match, their name becomes the stand-in's, and the guest id they played under before signing up, which the fair
 * play credit may name, is dropped. Without that the same guest id would join the anonymous matches back together.
 *
 * @template {{ players: ReadonlyArray<{ playerId: string, displayName: string }>, credit?: { notCounted: ReadonlyArray<object>, botXp?: ReadonlyArray<object> } }} M
 * @param {M} match
 * @param {{ playerId: string, stand: Readonly<{ id: string, displayName: string }> }} who
 * @returns {M}
 */
export function anonymisedMatch(match, { playerId, stand }) {
  const renamed = renamePlayer(match, playerId, stand.id);
  const players = renamed.players.map((p) =>
    p.playerId === stand.id ? { ...p, displayName: stand.displayName } : p,
  );
  if (renamed.credit === undefined) {
    return { ...renamed, players };
  }
  const { notCounted, botXp } = renamed.credit;
  const credit = {
    ...renamed.credit,
    notCounted: withoutGuest(notCounted, stand.id),
    ...(botXp !== undefined && { botXp: withoutGuest(botXp, stand.id) }),
  };
  return { ...renamed, players, credit };
}
