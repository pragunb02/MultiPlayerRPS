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
    signup: async (credentials) => (await request("POST", "/auth/signup", credentials)).identity,
    login: async (credentials) => (await request("POST", "/auth/login", credentials)).identity,
    getProgress: async () => (await request("GET", "/progress")).progress,
    getMatches: (query = {}) => request("GET", `/matches${toQuery(query)}`),
    getMatch: async (matchId) => (await request("GET", `/matches/${encodeURIComponent(matchId)}`)).match,
  });
}

function toQuery(query) {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined));
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
