import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api.js";
import { AppRequestError } from "./errors.js";

const respond = (status, body) =>
  vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body });

describe("api client", () => {
  it("calls same-origin /api paths with the session cookie and unwraps the payload", async () => {
    const fetchImpl = respond(200, { games: [{ id: "rps" }] });

    const games = await createApiClient({ fetchImpl }).getGames();

    expect(games).toEqual([{ id: "rps" }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/games",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it.each([
    [
      { authenticated: true, identity: { kind: "guest", id: "guest_x" } },
      { kind: "guest", id: "guest_x" },
    ],
    [{ authenticated: false }, undefined],
  ])("reads the session: identity, or none yet (%o)", async (body, expected) => {
    expect(await createApiClient({ fetchImpl: respond(200, body) }).getSession()).toEqual(expected);
  });

  it.each([
    [{ identity: { id: "user_x" } }, { identity: { id: "user_x" } }],
    [
      { identity: { id: "user_x" }, carriedOver: { xp: 30, matchesPlayed: 1, matches: 1 } },
      { identity: { id: "user_x" }, carriedOver: { xp: 30, matchesPlayed: 1, matches: 1 } },
    ],
  ])(
    "answers sign-up and login with the identity and what a guest brought along (%o)",
    async (body, expected) => {
      const api = createApiClient({ fetchImpl: respond(200, body) });

      expect(await api.signup({})).toEqual(expected);
      expect(await api.login({})).toEqual(expected);
    },
  );

  it("sends JSON bodies", async () => {
    const fetchImpl = respond(200, { identity: { id: "user_x" } });

    await createApiClient({ fetchImpl }).login({ email: "a@b.co", password: "pw" });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ email: "a@b.co", password: "pw" });
  });

  it("turns error responses into AppRequestError with the server's code", async () => {
    const fetchImpl = respond(409, {
      error: { code: "CONFLICT", message: "That username is taken", details: { field: "username" } },
    });

    const error = await createApiClient({ fetchImpl })
      .signup({})
      .catch((err) => err);

    expect(error).toBeInstanceOf(AppRequestError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: "That username is taken",
      details: { field: "username" },
    });
  });

  it("reports an unreadable error body as UNKNOWN", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ status: 502, ok: false, json: async () => Promise.reject(new Error("html")) });

    await expect(createApiClient({ fetchImpl }).getGames()).rejects.toMatchObject({
      code: "UNKNOWN",
      status: 502,
    });
  });

  it("reports network failures as NETWORK", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(createApiClient({ fetchImpl }).getGames()).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("handles 204 No Content", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 204, ok: true });

    await expect(createApiClient({ fetchImpl }).endSession()).resolves.toEqual({});
  });

  it("builds match-history queries", async () => {
    const fetchImpl = respond(200, { matches: [] });

    await createApiClient({ fetchImpl }).getMatches({ limit: 5, before: undefined });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/matches?limit=5");
  });

  it("starts a guest session and unwraps the identity", async () => {
    const fetchImpl = respond(201, { identity: { kind: "guest", id: "guest_x" } });

    expect(await createApiClient({ fetchImpl }).startGuest()).toEqual({ kind: "guest", id: "guest_x" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/session/guest", expect.objectContaining({ method: "POST" }));
  });

  it("reads progress and one match, encoding the match id into the path", async () => {
    const progress = respond(200, { progress: { xp: 30 } });
    const match = respond(200, { match: { matchId: "a/b c" } });

    expect(await createApiClient({ fetchImpl: progress }).getProgress()).toEqual({ xp: 30 });
    expect(await createApiClient({ fetchImpl: match }).getMatch("a/b c")).toEqual({ matchId: "a/b c" });
    expect(progress.mock.calls[0][0]).toBe("/api/progress");
    expect(match.mock.calls[0][0]).toBe("/api/matches/a%2Fb%20c");
  });

  it("asks for match history without a query string when there are no filters", async () => {
    const fetchImpl = respond(200, { matches: [] });

    await createApiClient({ fetchImpl }).getMatches();

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/matches");
  });

  it("uses the browser's fetch by default", async () => {
    const fetchImpl = respond(200, { games: [] });
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await createApiClient().getGames();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchImpl).toHaveBeenCalledWith("/api/games", expect.objectContaining({ method: "GET" }));
  });
});
