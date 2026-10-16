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
});
