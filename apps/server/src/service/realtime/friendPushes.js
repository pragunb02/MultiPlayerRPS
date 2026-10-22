import { SOCKET_EVENTS } from "@classicade/shared";
import { FRIEND_EVENTS } from "../../domain/friends/friendComponent.js";
import { PRESENCE_EVENTS } from "../../domain/friends/presenceTracker.js";
import { playerChannel } from "./roomHandlers.js";

/** How long a tab has to answer a friend request ring (CC-341). A live page answers at once. */
const RING_ACK_TIMEOUT_MS = 10_000;

/**
 * Domain to transport for friends (CC-052, ADR-066.10). Every push goes to one player's own tabs and names other
 * people by display name, avatar and profile handle only, never by player id.
 *
 * 1. A player's friends view changed: their tabs get the whole view again, read only when a tab is connected.
 * 2. A player was sent a request they can see: each of their tabs gets it, for a toast on any page, and answers
 *    once its page has it. Only then is the ring noted as heard by that tab's browser (its session, CC-341).
 * 3. A player's presence may have changed: each friend's tabs get `{ handle, presence }`.
 * 4. A tab connected: it alone gets each request of (2) that rang in the last minutes, still waits and no tab of
 *    its browser answered, because the ring came while that browser had no live connection: between pages,
 *    reconnecting, or on a socket that had died without closing yet (CC-341). What it answers is noted the same way.
 *    A browser that heard a ring is not sent it again, so a reload shows no second toast. The friend component keeps
 *    who heard what beside each session, so a restart forgets nothing. A page too old to answer is sent a ring again
 *    on each load for those minutes, until it reloads into the current version.
 *
 * A push that fails is logged and dropped: the page loads the view again whenever it opens. The answer is how the
 * gateway tells the presence tracker that a player's tab opened or closed.
 *
 * @param {{
 *   io: import("socket.io").Server,
 *   domainEvents: import("node:events").EventEmitter,
 *   friendComponent: Pick<ReturnType<typeof import("../../domain/friends/friendComponent.js").createFriendComponent>, "viewFor" | "presenceAudience" | "missedRings" | "ringsHeard">,
 *   presence: Pick<ReturnType<typeof import("../../domain/friends/presenceTracker.js").createPresenceTracker>, "connected" | "disconnected">,
 *   logger: import("../../utils/logger.js").Logger,
 *   now: () => number,
 *   ackTimeoutMs?: number,
 * }} deps  `ackTimeoutMs`: how long a tab has to answer a ring before it counts as not heard
 * @returns {Readonly<{
 *   tabOpened: (playerId: string) => void,
 *   tabClosed: (playerId: string) => void,
 *   tellMissed: (tab: { socket: Pick<import("socket.io").Socket, "timeout">, playerId: string, sessionId: string }) => void,
 * }>}
 */
export function connectFriendPushes({
  io,
  domainEvents,
  friendComponent,
  presence,
  logger,
  now,
  ackTimeoutMs = RING_ACK_TIMEOUT_MS,
}) {
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

  /** Rings one tab, and notes the ring as heard by its browser once its page answered. No answer, no note. */
  function ringTab(socket, sessionId, request) {
    socket.timeout(ackTimeoutMs).emit(SOCKET_EVENTS.FRIEND_REQUESTED, request, (unanswered) => {
      if (unanswered) return;
      friendComponent.ringsHeard({ sessionId, rings: [request], now: now() }).catch(failed("a heard ring"));
    });
  }

  domainEvents.on(FRIEND_EVENTS.REQUESTED, ({ recipientId, request }) => {
    io.in(playerChannel(recipientId))
      .fetchSockets()
      .then((sockets) => sockets.forEach((socket) => ringTab(socket, socket.data.sessionId, request)))
      .catch(failed("a friend request"));
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
        .missedRings({ playerId, sessionId, now: now() })
        .then((rings) => rings.forEach((request) => ringTab(socket, sessionId, request)))
        .catch(failed("missed friend requests"));
    },
  });
}
