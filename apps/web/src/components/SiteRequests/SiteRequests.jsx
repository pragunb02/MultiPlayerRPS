import { useEffect, useEffectEvent, useId, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  CHALLENGE_POPUP_MS,
  CHALLENGE_STATES,
  getGame,
  REQUEST_ANSWERS,
  REQUEST_STATES,
  SOCKET_EVENTS,
} from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useServices } from "../../app/servicesContext.js";
import { textsFor } from "../../games/roomUpdates.js";
import { useAction } from "../../hooks/useAction.js";
import { useReconnecting } from "../../hooks/useReconnecting.js";
import { useSiteRequests } from "../../hooks/useSiteRequests.js";
import { useSound } from "../../hooks/useSound.js";
import { useDocumentHidden, useTabAlert } from "../../hooks/useTurnAlert.js";
import { CATEGORIES } from "../../lib/notify/categories.js";
import { SOUNDS } from "../../lib/sound/sounds.js";
import { Button } from "../Button/Button.jsx";
import { CHALLENGE_COPY } from "../Challenges/challengeCopy.js";
import { INVITE_COPY } from "../Friends/inviteCopy.js";
import { useChallengeInbox } from "../Challenges/challengesContext.js";
import { Bilingual } from "../Profile/Bilingual.jsx";
import { RequestCountdown } from "../RequestBanner/RequestBanner.jsx";
import { useHold, useToast } from "../Toast/toastContext.js";
import { useInGame } from "./inGameContext.js";
import styles from "./SiteRequests.module.css";

const keyOf = (code, request) => `${code}:${request.type}:${request.from}:${request.createdAt}`;
const gameName = (gameId) => getGame(gameId)?.name ?? "a game";
const both = (copy) => `${copy.hi} ${copy.en}`;

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
 * The challenges that call for the player now (CC-139): one sent to them that is still open, and one of theirs that
 * someone took, while its room waits. Neither once it is in the inbox, nor on the page it would send them to.
 */
function useChallengeCalls(pathname) {
  const { challenges } = useChallengeInbox();
  return challenges.filter((challenge) => {
    if (challenge.later) return false;
    if (challenge.forYou && challenge.state === CHALLENGE_STATES.OPEN) {
      return pathname !== paths.challenge(challenge.id);
    }
    return (
      challenge.own &&
      challenge.state === CHALLENGE_STATES.ACCEPTED &&
      challenge.room !== undefined &&
      pathname !== paths.room(challenge.room.gameId, challenge.room.code)
    );
  });
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

/**
 * How invites to one person end, told on any page (CC-052):
 *
 * 1. Its sender, when the friend said no, or when it ran out with no answer: the same gentle "Not right now" for
 *    both. A block reads as no answer, because a blocked pair's invite is never delivered (scenario 7, ADR-053).
 * 2. Its friend, when another friend took the sender's invite to the same game first: "Game filled", with the way to
 *    invite the sender again (scenario 6).
 */
function useEndingToasts() {
  const { challenges } = useChallengeInbox();
  const toast = useToast();
  const before = useRef(new Map());

  useEffect(() => {
    const previous = before.current;
    const now = Date.now();
    before.current = new Map(challenges.map((challenge) => [challenge.id, challenge]));
    const wasOpen = (id) => previous.get(id)?.state === CHALLENGE_STATES.OPEN;
    const notRightNow = (name) =>
      toast.show(both(CHALLENGE_COPY.notRightNow(name)), { tone: "info", category: CATEGORIES.REQUEST });
    for (const challenge of challenges) {
      if (challenge.own && challenge.state === CHALLENGE_STATES.DECLINED && wasOpen(challenge.id)) {
        notRightNow(challenge.toName);
      }
      if (challenge.forYou && challenge.state === CHALLENGE_STATES.FILLED && wasOpen(challenge.id)) {
        toast.show(both(INVITE_COPY.gameFilledShort(challenge.fromName)), {
          tone: "info",
          category: CATEGORIES.REQUEST,
          action: {
            label: "Invite again?",
            to: paths.challenge(challenge.id),
            dismissLabel: "Close",
            onDismiss: () => undefined,
          },
        });
      }
    }
    // The tab lets an open invite go at its end. Its sender hears "Not right now", as for a decline.
    const current = new Set(challenges.map((challenge) => challenge.id));
    for (const [id, gone] of previous) {
      if (!current.has(id) && gone.own && gone.toOne && wasOpen(id) && now >= gone.expiresAt) {
        notRightNow(gone.toName);
      }
    }
  }, [challenges, toast]);
}

/**
 * Moves each challenge popup to the inbox once it has been on screen for about a minute (CC-207). Only the time the
 * player could see it counts: while the tab is in the background, or a game holds the popups back, its clock
 * stops, so a popup never moves away unseen and the tab alert keeps calling the player back.
 */
function useMoveToInbox(calls, paused) {
  const { later } = useChallengeInbox();
  // For each popup on the page: how long it has been seen, and since when it is being seen (0 while paused).
  const clocks = useRef(new Map());
  const ids = calls.map((challenge) => challenge.id).join(" ");
  const seenFor = (clock, now) => clock.spent + (clock.since === 0 ? 0 : now - clock.since);

  const moveDue = useEffectEvent(() => {
    const now = Date.now();
    for (const [id, clock] of clocks.current) {
      if (seenFor(clock, now) >= CHALLENGE_POPUP_MS) {
        clocks.current.delete(id);
        later(id);
      }
    }
  });

  useEffect(() => {
    const showing = ids === "" ? [] : ids.split(" ");
    const now = Date.now();
    for (const id of [...clocks.current.keys()]) {
      if (!showing.includes(id)) clocks.current.delete(id);
    }
    for (const id of showing) {
      const clock = clocks.current.get(id) ?? { spent: 0, since: 0 };
      clocks.current.set(id, { spent: seenFor(clock, now), since: paused ? 0 : now });
    }
    if (paused || showing.length === 0) return undefined;
    const next = Math.min(...showing.map((id) => CHALLENGE_POPUP_MS - clocks.current.get(id).spent));
    const timer = setTimeout(moveDue, Math.max(0, next));
    return () => clearTimeout(timer);
  }, [ids, paused]);
}

/** One question from another room, with Accept and go, Not now and how long is left. */
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
  // Rematch and draw requests end within a minute, so Not now answers them: the asker is not left waiting.
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
          Not now
        </Button>
      </div>
    </section>
  );
}

/**
 * A challenge that calls for the player (CC-139): one sent to them, with Accept and go, or one of theirs that
 * someone took, with Go and play. Not now moves it to the inbox without answering, because a challenge waits a day.
 */
function ChallengePopup({ challenge, reason }) {
  const { api } = useServices();
  const navigate = useNavigate();
  const { later, remember } = useChallengeInbox();
  const titleId = useId();
  const questionId = useId();
  const game = gameName(challenge.gameId);
  const taken = challenge.own;
  const copy = taken
    ? CHALLENGE_COPY.tookYours(challenge.acceptedName, game)
    : CHALLENGE_COPY.challengesYou(challenge.fromName, game);
  const go = useAction(
    async () => {
      if (taken) {
        later(challenge.id);
        navigate(paths.room(challenge.room.gameId, challenge.room.code));
        return;
      }
      const { challenge: accepted, room } = await api.acceptChallenge(challenge.id);
      remember(accepted);
      navigate(paths.room(room.gameId, room.code));
    },
    { id: "site_challenge.accept" },
  );

  return (
    <section className={styles.popup} aria-labelledby={titleId} aria-describedby={questionId}>
      <h2 id={titleId} className={styles.title}>
        {taken ? "Challenge taken" : "Challenge"}
      </h2>
      <div id={questionId} className={styles.question} role="alert">
        <Bilingual copy={copy} />
      </div>
      <div className={styles.actions}>
        <Button control="site_challenge.accept" action={go} reason={reason}>
          {taken ? "Go and play" : "Accept and go"}
        </Button>
        <Button
          control="site_challenge.later"
          variant="secondary"
          onClick={() => later(challenge.id)}
          reason={go.busy ? "Sending your answer" : ""}
        >
          Not now
        </Button>
      </div>
    </section>
  );
}

/**
 * Requests that reach a player on any page of the site (CC-207): a rematch or a draw offer from another room ("Bob
 * wants a rematch at Chess"), a challenge sent to them, or one of theirs that someone took (CC-139). Each has Accept
 * and go and Not now, a chime, the tab title calling them back, and an urgent announcement. It sits at the top of the
 * page, under the header, and pushes the page down instead of covering it. While a question waits, reward toasts
 * wait too (CC-208). A challenge left for about a minute moves to the inbox. A player in a game on the room page is
 * never interrupted: everything waits, the sound and the tab alert too, until the game ends.
 */
export function SiteRequests() {
  const { rooms, pathname, asked } = useElsewhere();
  const calls = useChallengeCalls(pathname);
  const held = useInGame();
  const sound = useSound();
  const reconnecting = useReconnecting();
  const heard = useRef(new Set());
  useAnswerToasts({ rooms, pathname });
  useEndingToasts();
  const hidden = useDocumentHidden();
  useMoveToInbox(calls, held || hidden);
  const waiting = !held && asked.length + calls.length > 0;
  useHold(CATEGORIES.REQUEST, waiting);
  const firstTitle =
    asked.length > 0 ? textsFor(asked[0].room.gameId, asked[0].request.type).title : "Challenge";
  useTabAlert(waiting, waiting ? `${firstTitle} · ClassiCade` : "");

  const keys = held
    ? ""
    : [...asked.map(({ key }) => key), ...calls.map(({ id, state }) => `${id}:${state}`)].join(" ");
  useEffect(() => {
    const fresh = keys.split(" ").filter((key) => key !== "" && !heard.current.has(key));
    fresh.forEach((key) => heard.current.add(key));
    if (fresh.length > 0) sound.play(SOUNDS.NOTIFY);
  }, [keys, sound]);

  if (!waiting) {
    return null;
  }
  const reason = reconnecting ? "Reconnecting" : "";
  return (
    <div className={styles.stack} data-cc-site-requests="">
      {asked.map(({ room, request, key }) => (
        <SitePopup key={key} room={room} request={request} reason={reason} />
      ))}
      {calls.map((challenge) => (
        <ChallengePopup key={`${challenge.id}:${challenge.state}`} challenge={challenge} reason={reason} />
      ))}
    </div>
  );
}
