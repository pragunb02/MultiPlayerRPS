import { useEffect, useState } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../../app/servicesContext.js";

const NONE = new Map();

/**
 * The chess ratings of a room's seated players, by seat: 0 for the room's first seat (CC-042). The server names
 * seats this way, never by player id (CC-253). Asked for when the room's game starts and again when it ends, and
 * replaced by the ratings the room hears when its game was rated. A shared screen sends nothing, because a game
 * there is never counted and never leaves the phone (ADR-054). When asking fails the bars show no rating, and the
 * next change asks again: a rating is extra information, never needed to play.
 *
 * @param {{ code: string, status: string, sharedScreen?: boolean, game?: { matchId: string } }} room
 * @returns {ReadonlyMap<number, { seat: number, rating: number, deviation: number, games: number, provisional: boolean, change?: number }>}
 */
export function useRoomRatings(room) {
  const { socket } = useServices();
  const matchId = room.game?.matchId ?? "";
  const asks = room.sharedScreen !== true && matchId !== "";
  const [shown, setShown] = useState({ matchId: "", ratings: NONE });

  useEffect(() => {
    if (!asks) {
      return undefined;
    }
    let current = true;
    // An answer read before the game was rated can arrive after the push that says it was. The push wins.
    let pushed = false;
    const show = (ratings) => {
      if (current) setShown({ matchId, ratings: new Map(ratings.map((entry) => [entry.seat, entry])) });
    };
    socket.request(SOCKET_EVENTS.RATING_ROOM, { code: room.code }).then(
      ({ ratings }) => pushed || show(ratings),
      () => undefined,
    );
    const off = socket.on(SOCKET_EVENTS.RATING_UPDATED, (update) => {
      if (update.matchId !== matchId) return;
      pushed = true;
      show(update.ratings);
    });
    return () => {
      current = false;
      off();
    };
    // The status is listed so the ratings are asked for again when the game ends, in case the push was missed.
  }, [socket, asks, room.code, matchId, room.status]);

  return shown.matchId === matchId ? shown.ratings : NONE;
}
