import { AppRequestError, networkError } from "./errors.js";

/**
 * The HTTP API client — the only place the web app calls `fetch`. Same-origin requests carry the session
 * cookie automatically; errors become AppRequestError with the server's code.
 *
 * @param {{ fetchImpl?: typeof fetch, baseUrl?: string }} [options]  injectable for tests
 */
export function createApiClient({ fetchImpl = (...args) => fetch(...args), baseUrl = "" } = {}) {
  async function request(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/api${path}`, {
        method,
        credentials: "same-origin",
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw networkError(err);
    }
    if (res.status === 204) {
      return {};
    }
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new AppRequestError({
        ...(payload.error ?? { code: "UNKNOWN", message: "Something went wrong" }),
        status: res.status,
      });
    }
    return payload;
  }

  return Object.freeze({
    getGames: async () => (await request("GET", "/games")).games,
    /** @returns {Promise<object | undefined>} the session's identity, or undefined before the first visit has one */
    getSession: async () => {
      const body = await request("GET", "/session");
      return body.authenticated ? body.identity : undefined;
    },
    startGuest: async () => (await request("POST", "/session/guest")).identity,
    endSession: () => request("DELETE", "/session"),
    /**
     * Signing up or logging in answers who you are now and — when you were a guest with games — what your guest
     * progress brought along (CC-032).
     * @returns {Promise<{ identity: object, carriedOver?: { xp: number, matchesPlayed: number, matches: number } }>}
     */
    signup: async (credentials) => signedIn(await request("POST", "/auth/signup", credentials)),
    /** @returns {Promise<{ identity: object, carriedOver?: { xp: number, matchesPlayed: number, matches: number } }>} */
    login: async (credentials) => signedIn(await request("POST", "/auth/login", credentials)),
    getProgress: async () => (await request("GET", "/progress")).progress,
    getMatches: (query = {}) => request("GET", `/matches${toQuery(query)}`),
    getMatch: async (matchId) => (await request("GET", `/matches/${encodeURIComponent(matchId)}`)).match,
    /** The whole achievement catalog with your progress and unlock times (CC-054). */
    getAchievements: async () => (await request("GET", "/achievements")).achievements,
    /** Your win streak and daily play streak (CC-054). */
    getStreaks: async () => (await request("GET", "/streaks")).streaks,
    /** Today's quests (UTC day), the sweep bonus and when they reset (CC-089). */
    getQuests: async () => (await request("GET", "/quests")).quests,
    getLeaderboards: async () => (await request("GET", "/leaderboards")).boards,
    /** @returns {Promise<{ board: object, entries: object[], you?: object }>} */
    getLeaderboard: (boardId, query = {}) =>
      request("GET", `/leaderboards/${encodeURIComponent(boardId)}${toQuery(query)}`),
  });
}

const signedIn = ({ identity, carriedOver }) => ({
  identity,
  ...(carriedOver !== undefined && { carriedOver }),
});

function toQuery(query) {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined));
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
