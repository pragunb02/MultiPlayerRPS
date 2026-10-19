import { useEffect, useEffectEvent, useId, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { getGame, REQUEST_ANSWERS, REQUEST_STATES, SOCKET_EVENTS } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useServices } from "../../app/servicesContext.js";
import { textsFor } from "../../games/roomUpdates.js";
import { useAction } from "../../hooks/useAction.js";
import { useReconnecting } from "../../hooks/useReconnecting.js";
import { useSiteRequests } from "../../hooks/useSiteRequests.js";
import { useSound } from "../../hooks/useSound.js";
import { useTabAlert } from "../../hooks/useTurnAlert.js";
import { CATEGORIES } from "../../lib/notify/categories.js";
import { SOUNDS } from "../../lib/sound/sounds.js";
import { Button } from "../Button/Button.jsx";
import { RequestCountdown } from "../RequestBanner/RequestBanner.jsx";
import { useHold, useToast } from "../Toast/toastContext.js";
import styles from "./SiteRequests.module.css";

const keyOf = (code, request) => `${code}:${request.type}:${request.from}:${request.createdAt}`;
const gameName = (gameId) => getGame(gameId)?.name ?? "a game";

/**
 * The requests a player was asked in rooms whose page they are not on (CC-207), and how the ones they asked ended.
 * On the room's own page the request banner shows them instead. Each push names the players by seat id, and `you`
 * is the player's own seat in that room (CC-253).
 */
function useElsewhere() {
  const rooms = useSiteRequests();
  const { pathname } = useLocation();
  const elsewhere = Object.values(rooms).filter((room) => pathname !== paths.room(room.gameId, room.code));
  const asked = elsewhere.flatMap((room) =>
    room.requests
      .filter((request) => request.state === REQUEST_STATES.OPEN && request.to === room.you)
      .map((request) => ({ room, request, key: keyOf(room.code, request) })),
  );
  return { rooms, pathname, asked };
}

/**
 * Tells the asker, on whatever page they are, how their request ended when they are not on its room's page: the
 * other player said yes (with the way back to the game), said no, or did not answer in time.
 */
function useAnswerToasts({ rooms, pathname }) {
  const toast = useToast();
  const before = useRef(rooms);

  const tell = useEffectEvent((previous) => {
    const elsewhere = Object.values(rooms).filter((room) => pathname !== paths.room(room.gameId, room.code));
    for (const room of elsewhere) {
      const open = new Set(
        (previous[room.code]?.requests ?? [])
          .filter((request) => request.state === REQUEST_STATES.OPEN)
          .map((request) => keyOf(room.code, request)),
      );
      const ended = room.requests.filter(
        (request) =>
          request.from === room.you &&
          request.state !== REQUEST_STATES.OPEN &&
          open.has(keyOf(room.code, request)),
      );
      for (const request of ended) {
        const texts = textsFor(room.gameId, request.type);
        const name = room.names[request.to] ?? "Your opponent";
        const back = {
          label: request.state === REQUEST_STATES.ACCEPTED ? "Go to the game" : "Back to the room",
          to: paths.room(room.gameId, room.code),
          dismissLabel: "Close",
          onDismiss: () => undefined,
        };
        if (request.state === REQUEST_STATES.ACCEPTED) {
          toast.show(texts.accepted(name), { tone: "success", category: CATEGORIES.REQUEST, action: back });
        } else if (request.state === REQUEST_STATES.DECLINED) {
          toast.show(texts.declined(name), { tone: "info", category: CATEGORIES.REQUEST, action: back });
        } else if (request.state === REQUEST_STATES.EXPIRED) {
          toast.show(`No answer from ${name}`, { tone: "info", category: CATEGORIES.REQUEST, action: back });
        }
      }
    }
  });

  useEffect(() => {
    const previous = before.current;
    before.current = rooms;
    if (previous !== rooms) tell(previous);
  }, [rooms]);
}

/** One question from another room, with Accept and go, Decline and how long is left. */
function SitePopup({ room, request, reason }) {
  const { socket } = useServices();
  const navigate = useNavigate();
  const titleId = useId();
  const questionId = useId();
  const texts = textsFor(room.gameId, request.type);
  const from = room.names[request.from] ?? "Someone";
  const answer = (reply) =>
    socket.request(SOCKET_EVENTS.ROOM_ANSWER, { code: room.code, type: request.type, answer: reply });
  const accept = useAction(
    async () => {
      await answer(REQUEST_ANSWERS.ACCEPT);
      navigate(paths.room(room.gameId, room.code));
    },
    { id: "site_request.accept" },
  );
  const decline = useAction(() => answer(REQUEST_ANSWERS.DECLINE), { id: "site_request.decline" });
  const answering = accept.busy || decline.busy ? "Sending your answer" : "";

  return (
    <section className={styles.popup} aria-labelledby={titleId} aria-describedby={questionId}>
      <h2 id={titleId} className={styles.title}>
        {texts.title}
      </h2>
      <p id={questionId} className={styles.question} role="alert">
        {from} {texts.site(gameName(room.gameId))}
      </p>
      <RequestCountdown request={request} serverTime={room.serverTime} />
      <div className={styles.actions}>
        <Button
          control="site_request.accept"
          action={accept}
          reason={reason || (decline.busy ? answering : "")}
        >
          Accept and go
        </Button>
        <Button
          control="site_request.decline"
          variant="secondary"
          action={decline}
          reason={reason || (accept.busy ? answering : "")}
        >
          Decline
        </Button>
      </div>
    </section>
  );
}

/**
 * Requests that reach a player on any page of the site (CC-207): "Bob wants a rematch at Chess" with Accept and
 * go (which accepts and opens the room) and Decline, a chime, the tab title calling them back, and an urgent
 * announcement. It sits at the top of the page, under the header, and pushes the page down instead of covering
 * it. While a question waits, reward toasts wait too (CC-208). The asker hears how it ended in a toast.
 */
export function SiteRequests() {
  const { rooms, pathname, asked } = useElsewhere();
  const sound = useSound();
  const reconnecting = useReconnecting();
  const heard = useRef(new Set());
  useAnswerToasts({ rooms, pathname });
  useHold(CATEGORIES.REQUEST, asked.length > 0);
  useTabAlert(
    asked.length > 0,
    asked.length > 0 ? `${textsFor(asked[0].room.gameId, asked[0].request.type).title} · ClassiCade` : "",
  );

  const keys = asked.map(({ key }) => key).join(" ");
  useEffect(() => {
    const fresh = keys.split(" ").filter((key) => key !== "" && !heard.current.has(key));
    fresh.forEach((key) => heard.current.add(key));
    if (fresh.length > 0) sound.play(SOUNDS.NOTIFY);
  }, [keys, sound]);

  if (asked.length === 0) {
    return null;
  }
  return (
    <div className={styles.stack} data-cc-site-requests="">
      {asked.map(({ room, request, key }) => (
        <SitePopup key={key} room={room} request={request} reason={reconnecting ? "Reconnecting" : ""} />
      ))}
    </div>
  );
}
