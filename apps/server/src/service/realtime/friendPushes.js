import { SOCKET_EVENTS } from "@classicade/shared";
import { FRIEND_EVENTS } from "../../domain/friends/friendComponent.js";
import { FRIEND_LIMITS } from "../../domain/friends/friendRules.js";
import { PRESENCE_EVENTS } from "../../domain/friends/presenceTracker.js";
import { playerChannel } from "./roomHandlers.js";

/**
 * Domain to transport for friends (CC-052, ADR-066.10). Every push goes to one player's own tabs and names other
 * people by display name, avatar and profile handle only, never by player id.
 *
 * 1. A player's friends view changed: their tabs get the whole view again, read only when a tab is connected.
 * 2. A player was sent a request they can see: their tabs get it, for a toast on any page.
 * 3. A player's presence may have changed: each friend's tabs get `{ handle, presence }`.
 * 4. A tab connected: it alone gets each request of (2) that rang in the last minutes, still waits and was never
 *    sent to a tab of its browser (its session), because the ring came while that browser had no connection, between
 *    pages or reconnecting (CC-341). A browser that heard a ring is never sent it again, so a reload shows no
 *    second toast. Who heard what is kept in memory only as long as a ring can be sent again; after a restart a
 *    browser may be sent one ring of those minutes a second time.
 *
 * A push that fails is logged and dropped: the page loads the view again whenever it opens. The answer is how the
 * gateway tells the presence tracker that a player's tab opened or closed.
 *
 * @param {{
 *   io: import("socket.io").Server,
 *   domainEvents: import("node:events").EventEmitter,
 *   friendComponent: Pick<ReturnType<typeof import("../../domain/friends/friendComponent.js").createFriendComponent>, "viewFor" | "presenceAudience" | "missedRings">,
 *   presence: Pick<ReturnType<typeof import("../../domain/friends/presenceTracker.js").createPresenceTracker>, "connected" | "disconnected">,
 *   logger: import("../../utils/logger.js").Logger,
 *   now: () => number,
 * }} deps
 * @returns {Readonly<{
 *   tabOpened: (playerId: string) => void,
 *   tabClosed: (playerId: string) => void,
 *   tellMissed: (tab: { socket: Pick<import("socket.io").Socket, "emit">, playerId: string, sessionId: string }) => void,
 *   remembered: () => number,
 * }>}  `remembered` counts the rings kept as heard, for tests
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

  // Which browser heard which ring, oldest first: `${sessionId} ${requestId} ${ringAt}` to when (CC-341).
  /** @type {Map<string, number>} */
  const heard = new Map();
  const heardKey = (sessionId, request) => `${sessionId} ${request.requestId} ${request.ringAt}`;
  function noteHeard(sessionIds, request) {
    const at = now();
    for (const [key, when] of heard) {
      if (when > at - FRIEND_LIMITS.missedRingWithinMs) break;
      heard.delete(key);
    }
    for (const sessionId of sessionIds) {
      heard.delete(heardKey(sessionId, request));
      heard.set(heardKey(sessionId, request), at);
    }
  }

  // The browsers with a tab in the channel are noted before the push goes out. A tab that connects in between gets
  // both the push and, as it connects, the same ring again; its toasts show the same message once (ToastProvider).
  domainEvents.on(FRIEND_EVENTS.REQUESTED, ({ recipientId, request }) => {
    const channel = playerChannel(recipientId);
    io.in(channel)
      .fetchSockets()
      .then(
        (sockets) => noteHeard(new Set(sockets.map((socket) => socket.data.sessionId)), request),
        failed("who heard a friend request"),
      )
      .finally(() => io.to(channel).emit(SOCKET_EVENTS.FRIEND_REQUESTED, request));
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
    tellMissed({ socket, playerId, sessionId }) {
      friendComponent
        .missedRings({ playerId, now: now() })
        .then((rings) => {
          for (const request of rings.filter((ring) => !heard.has(heardKey(sessionId, ring)))) {
            noteHeard([sessionId], request);
            socket.emit(SOCKET_EVENTS.FRIEND_REQUESTED, request);
          }
        })
        .catch(failed("missed friend requests"));
    },
    remembered: () => heard.size,
  });
}
