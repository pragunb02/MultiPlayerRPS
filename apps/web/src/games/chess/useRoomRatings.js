import { useEffect, useState } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../../app/servicesContext.js";

const NONE = new Map();

/**
 * The chess ratings of a room's seated players, by player id (CC-042). Asked for once per game of the room, and
 * replaced by the ratings the room hears when its game was rated. A shared screen sends nothing, because a game
 * there is never counted and never leaves the phone (ADR-054). When asking fails the bars show no rating, and the
 * next game asks again: a rating is extra information, never needed to play.
 *
 * @param {{ code: string, status: string, sharedScreen?: boolean, game?: { matchId: string } }} room
 * @returns {ReadonlyMap<string, { playerId: string, rating: number, deviation: number, games: number, provisional: boolean, change?: number }>}
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
    const show = (ratings) => {
      if (current) setShown({ matchId, ratings: new Map(ratings.map((entry) => [entry.playerId, entry])) });
    };
    socket.request(SOCKET_EVENTS.RATING_ROOM, { code: room.code }).then(
      ({ ratings }) => show(ratings),
      () => undefined,
    );
    const off = socket.on(SOCKET_EVENTS.RATING_UPDATED, (update) => {
      if (update.matchId === matchId) show(update.ratings);
    });
    return () => {
      current = false;
      off();
    };
  }, [socket, asks, room.code, matchId]);

  return shown.matchId === matchId ? shown.ratings : NONE;
}
