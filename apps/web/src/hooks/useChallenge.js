import { useCallback, useEffect, useState } from "react";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useSession } from "./useSession.js";

const LOADING = Object.freeze({ status: "loading", challenge: undefined, error: undefined });

/**
 * What this viewer may see of a challenge (CC-139), kept current by the server's pushes to its creator and the one
 * it was sent to. Loads again whenever the viewer becomes someone else, such as a visitor who starts as a guest. An
 * id nobody has, or one the server has forgotten, is `notFound`.
 *
 * @param {string} id
 * @returns {{
 *   status: "loading" | "ready" | "notFound" | "error",
 *   challenge: Readonly<object> | undefined,
 *   error: Error | undefined,
 *   show: (challenge: object) => void,   shows a newer view this page got as an answer
 *   retry: () => void,
 * }}
 */
export function useChallenge(id) {
  const { api, socket } = useServices();
  const session = useSession();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: "", ...LOADING });
  const sessionKnown = session.status !== "loading";
  const key = JSON.stringify([id, session.identity?.id ?? "", attempt]);

  useEffect(() => {
    if (!sessionKnown) return undefined;
    let cancelled = false;
    api.getChallenge(id).then(
      (challenge) => !cancelled && setResult({ key, status: "ready", challenge, error: undefined }),
      (error) =>
        !cancelled &&
        setResult({
          key,
          status: error.code === ERROR_CODES.NOT_FOUND ? "notFound" : "error",
          challenge: undefined,
          error,
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, id, sessionKnown, key]);

  const show = useCallback(
    (challenge) => setResult({ key, status: "ready", challenge, error: undefined }),
    [key],
  );

  useEffect(
    () =>
      socket.on(SOCKET_EVENTS.CHALLENGE_UPDATED, ({ challenge }) => {
        if (challenge.id === id) show(challenge);
      }),
    [socket, id, show],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const { status, challenge, error } = result.key === key ? result : LOADING;
  return { status, challenge, error, show, retry };
}
