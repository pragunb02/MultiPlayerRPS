import { useCallback, useEffect, useState } from "react";
import { ERROR_CODES } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useSession } from "./useSession.js";

/**
 * The player's own profile (CC-034): its handle, the avatar, the visibility and whether it may be public, with ways
 * to change the avatar and the visibility. Loads again whenever the player becomes someone else.
 *
 * @returns {{
 *   status: "loading" | "ready" | "error",
 *   profile: { handle: string, avatar?: string, visibility: "public" | "private", canBePublic: boolean } | undefined,
 *   error: Error | undefined,
 *   setAvatar: (avatar: string) => Promise<void>,
 *   setVisibility: (visibility: "public" | "private") => Promise<void>,
 * }}
 */
export function useOwnProfile() {
  const { api } = useServices();
  const { identity } = useSession();
  const who = identity?.id ?? "";
  const [state, setState] = useState({ who: "", status: "loading", profile: undefined, error: undefined });

  useEffect(() => {
    if (who === "") return undefined;
    let cancelled = false;
    api.getOwnProfile().then(
      (profile) => !cancelled && setState({ who, status: "ready", profile, error: undefined }),
      (error) => !cancelled && setState({ who, status: "error", profile: undefined, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, who]);

  const setAvatar = useCallback(
    async (avatar) => {
      const profile = await api.setAvatar(avatar);
      setState({ who, status: "ready", profile, error: undefined });
    },
    [api, who],
  );
  const setVisibility = useCallback(
    async (visibility) => {
      const profile = await api.setProfileVisibility(visibility);
      setState({ who, status: "ready", profile, error: undefined });
    },
    [api, who],
  );

  const current = state.who === who ? state : { status: "loading", profile: undefined, error: undefined };
  return { status: current.status, profile: current.profile, error: current.error, setAvatar, setVisibility };
}

const LOADING = Object.freeze({ status: "loading", player: undefined, error: undefined });

/**
 * What this viewer may see at a profile handle (CC-034). A handle nobody has and a blocked pair look the same:
 * `notFound`. Loads again for another handle and whenever the viewer becomes someone else.
 *
 * @param {string} handle
 * @returns {{ status: "loading" | "ready" | "notFound" | "error", player: object | undefined, error: Error | undefined, retry: () => void }}
 */
export function usePlayerProfile(handle) {
  const { api } = useServices();
  const session = useSession();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: "", ...LOADING });
  const sessionKnown = session.status !== "loading";
  const key = JSON.stringify([handle, session.identity?.id ?? "", attempt]);

  useEffect(() => {
    if (!sessionKnown) return undefined;
    let cancelled = false;
    api.getPlayerProfile(handle).then(
      (player) => !cancelled && setResult({ key, status: "ready", player, error: undefined }),
      (error) =>
        !cancelled &&
        setResult({
          key,
          status: error.code === ERROR_CODES.NOT_FOUND ? "notFound" : "error",
          player: undefined,
          error,
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, handle, sessionKnown, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const { status, player, error } = result.key === key ? result : LOADING;
  return { status, player, error, retry };
}
