import { SOCKET_EVENTS } from "@classicade/shared";
import { FRIEND_EVENTS } from "../../domain/friends/friendComponent.js";
import { PRESENCE_EVENTS } from "../../domain/friends/presenceTracker.js";
import { playerChannel } from "./roomHandlers.js";

/**
 * Domain to transport for friends (CC-052, ADR-066.10). Every push goes to one player's own tabs and names other
 * people by display name, avatar and profile handle only, never by player id.
 *
 * 1. A player's friends view changed: their tabs get the whole view again, read only when a tab is connected.
 * 2. A player was sent a request they can see: their tabs get it, for a toast on any page.
 * 3. A player's presence may have changed: each friend's tabs get `{ handle, presence }`.
 *
 * A push that fails is logged and dropped: the page loads the view again whenever it opens. The answer is how the
 * gateway tells the presence tracker that a player's tab opened or closed.
 *
 * @param {{
 *   io: import("socket.io").Server,
 *   domainEvents: import("node:events").EventEmitter,
 *   friendComponent: Pick<ReturnType<typeof import("../../domain/friends/friendComponent.js").createFriendComponent>, "viewFor" | "presenceAudience">,
 *   presence: Pick<ReturnType<typeof import("../../domain/friends/presenceTracker.js").createPresenceTracker>, "connected" | "disconnected">,
 *   logger: import("../../utils/logger.js").Logger,
 *   now: () => number,
 * }} deps
 * @returns {Readonly<{ tabOpened: (playerId: string) => void, tabClosed: (playerId: string) => void }>}
 */
export function connectFriendPushes({ io, domainEvents, friendComponent, presence, logger, now }) {
  const failed = (what) => (err) => logger.error({ err }, `pushing ${what} failed`);
  // What friends were last told of each player, so a change they cannot see is never pushed: while a player appears
  // offline, their tabs and games come and go without a word to anyone (ADR-066.6).
  /** @type {Map<string, string>} */
  const lastShown = new Map();

  async function pushView(playerId) {
    if ((await io.in(playerChannel(playerId)).fetchSockets()).length === 0) return;
    const view = await friendComponent.viewFor({ playerId, now: now() });
    io.to(playerChannel(playerId)).emit(SOCKET_EVENTS.FRIENDS_UPDATED, view);
  }

  domainEvents.on(FRIEND_EVENTS.CHANGED, ({ playerIds }) => {
    for (const playerId of new Set(playerIds)) {
      pushView(playerId).catch(failed("a friends view"));
    }
  });

  domainEvents.on(FRIEND_EVENTS.REQUESTED, ({ recipientId, request }) => {
    io.to(playerChannel(recipientId)).emit(SOCKET_EVENTS.FRIEND_REQUESTED, request);
  });

  domainEvents.on(PRESENCE_EVENTS.CHANGED, ({ playerId }) => {
    friendComponent
      .presenceAudience({ playerId, now: now() })
      .then(({ handle, presence: shown, friendIds }) => {
        if (lastShown.get(playerId) === shown) return;
        lastShown.set(playerId, shown);
        for (const friendId of friendIds) {
          io.to(playerChannel(friendId)).emit(SOCKET_EVENTS.FRIEND_PRESENCE_CHANGED, {
            handle,
            presence: shown,
          });
        }
      })
      .catch(failed("a presence change"));
  });

  return Object.freeze({
    tabOpened(playerId) {
      presence
        .connected({ playerId })
        .catch((err) => logger.error({ err, playerId }, "recording a player's presence failed"));
    },
    tabClosed: (playerId) => presence.disconnected({ playerId }),
  });
}
