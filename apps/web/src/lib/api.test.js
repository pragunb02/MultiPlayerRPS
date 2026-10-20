import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api.js";
import { AppRequestError } from "./errors.js";

const respond = (status, body) =>
  vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body });

describe("api client", () => {
  it.each([
    [{ authenticated: true, identity: {}, admin: true }, true],
    [{ authenticated: true, identity: {} }, false],
    [{ authenticated: false }, false],
  ])("reads whether the session may open the owner console (%o)", async (body, expected) => {
    expect(await createApiClient({ fetchImpl: respond(200, body) }).getAdminStatus()).toBe(expected);
  });

  it("asks for the owner console's report for a range, or the default range", async () => {
    const fetchImpl = respond(200, { report: { range: {} } });
    const api = createApiClient({ fetchImpl });

    expect(await api.getAnalytics({ from: "2025-03-03", to: "2025-03-09", bucket: "week" })).toEqual({
      range: {},
    });
    await api.getAnalytics();

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "/api/admin/analytics?from=2025-03-03&to=2025-03-09&bucket=week",
      "/api/admin/analytics",
    ]);
  });

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

  it("changes the password and signs out other devices through the account routes (CC-116)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 204, ok: true, json: async () => ({}) });
    const api = createApiClient({ fetchImpl });

    await expect(
      api.changePassword({ currentPassword: "old one 1", newPassword: "new one 1" }),
    ).resolves.toBeUndefined();
    await expect(api.signOutOtherDevices()).resolves.toBeUndefined();

    const [[passwordUrl, passwordInit], [othersUrl, othersInit]] = fetchImpl.mock.calls;
    expect(passwordUrl).toBe("/api/auth/password");
    expect(JSON.parse(passwordInit.body)).toEqual({ currentPassword: "old one 1", newPassword: "new one 1" });
    expect([othersUrl, othersInit.method, othersInit.body]).toEqual([
      "/api/auth/sign-out-others",
      "POST",
      undefined,
    ]);
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

  it("reports a success whose answer was cut off as NETWORK, never as an empty answer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => Promise.reject(new TypeError("Load failed")),
    });

    await expect(createApiClient({ fetchImpl }).getGames()).rejects.toMatchObject({ code: "NETWORK" });
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

  it.each([
    ["getAchievements", "/api/achievements", { achievements: [{ id: "first-win" }] }, [{ id: "first-win" }]],
    ["getStreaks", "/api/streaks", { streaks: { win: { current: 1 } } }, { win: { current: 1 } }],
    ["getQuests", "/api/quests", { quests: { day: "2026-10-16" } }, { day: "2026-10-16" }],
  ])("%s reads %s and unwraps it", async (method, path, body, expected) => {
    const fetchImpl = respond(200, body);

    expect(await createApiClient({ fetchImpl })[method]()).toEqual(expected);
    expect(fetchImpl.mock.calls[0][0]).toBe(path);
  });

  it("reads today's daily puzzle, plays a move and takes a hint (CC-144)", async () => {
    const read = respond(200, { puzzle: { day: "2026-10-20" } });
    const moved = respond(200, { outcome: "correct", puzzle: { day: "2026-10-20" } });
    const hinted = respond(200, { hint: "Look for a fork.", puzzle: { day: "2026-10-20" } });

    expect(await createApiClient({ fetchImpl: read }).getDailyPuzzle("chess")).toEqual({ day: "2026-10-20" });
    expect(
      await createApiClient({ fetchImpl: moved }).playDailyMove("chess", {
        day: "2026-10-20",
        from: "f8",
        to: "d8",
      }),
    ).toEqual({ outcome: "correct", puzzle: { day: "2026-10-20" } });
    expect(
      await createApiClient({ fetchImpl: hinted }).takeDailyHint("chess", { day: "2026-10-20" }),
    ).toEqual({
      hint: "Look for a fork.",
      puzzle: { day: "2026-10-20" },
    });

    expect(read.mock.calls[0][0]).toBe("/api/daily/chess");
    expect(moved.mock.calls[0]).toEqual([
      "/api/daily/chess/moves",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ day: "2026-10-20", from: "f8", to: "d8" }),
      }),
    ]);
    expect(hinted.mock.calls[0]).toEqual([
      "/api/daily/chess/hints",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ day: "2026-10-20" }) }),
    ]);
  });

  it("reads and changes your own profile, and reads another's by handle only (CC-034)", async () => {
    const profile = { handle: "k3m9q2x7p4w8z1ab", visibility: "private", canBePublic: true };
    const read = respond(200, { profile });
    const avatar = respond(200, { profile: { ...profile, avatar: "owl" } });
    const visibility = respond(200, { profile: { ...profile, visibility: "public" } });
    const player = respond(200, { player: { handle: "a/b", hidden: true, displayName: "Hidden player" } });

    expect(await createApiClient({ fetchImpl: read }).getOwnProfile()).toEqual(profile);
    expect((await createApiClient({ fetchImpl: avatar }).setAvatar("owl")).avatar).toBe("owl");
    expect((await createApiClient({ fetchImpl: visibility }).setProfileVisibility("public")).visibility).toBe(
      "public",
    );
    expect((await createApiClient({ fetchImpl: player }).getPlayerProfile("a/b")).hidden).toBe(true);

    expect(read.mock.calls[0][0]).toBe("/api/profile");
    expect(avatar.mock.calls[0]).toEqual([
      "/api/profile/avatar",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ avatar: "owl" }) }),
    ]);
    expect(visibility.mock.calls[0]).toEqual([
      "/api/profile/visibility",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ visibility: "public" }) }),
    ]);
    expect(player.mock.calls[0][0]).toBe("/api/profiles/a%2Fb");
  });

  it("reports a player by where they met, and reads and acts on the owner's report queue (CC-044, ADR-071)", async () => {
    const reported = respond(200, { report: { reportId: "r1", createdAt: 1 } });
    const queued = respond(200, { groups: [{ groupId: "r1" }] });
    const acted = respond(200, { result: { closed: 2 } });
    const target = { matchId: "m1", seat: 1, reason: "name", note: "rude" };

    expect(await createApiClient({ fetchImpl: reported }).reportPlayer(target)).toEqual({
      reportId: "r1",
      createdAt: 1,
    });
    expect(await createApiClient({ fetchImpl: queued }).getReportQueue({ status: "dismissed" })).toEqual([
      { groupId: "r1" },
    ]);
    expect(await createApiClient({ fetchImpl: acted }).actOnReports("a/b", "dismiss")).toEqual({ closed: 2 });

    expect(reported.mock.calls[0]).toEqual([
      "/api/reports",
      expect.objectContaining({ method: "POST", body: JSON.stringify(target) }),
    ]);
    expect(queued.mock.calls[0][0]).toBe("/api/admin/reports?status=dismissed");
    expect(acted.mock.calls[0]).toEqual([
      "/api/admin/reports/a%2Fb/actions",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "dismiss" }) }),
    ]);
  });

  it("lists, adds and removes blocks, never with a player id (CC-044)", async () => {
    const listed = respond(200, { blocks: [{ blockId: "b1", displayName: "Bob", blockedAt: 1 }] });
    const added = respond(200, { block: { blockId: "b2", displayName: "Bob", blockedAt: 2 } });
    const removed = vi.fn().mockResolvedValue({ status: 204, ok: true });

    expect(await createApiClient({ fetchImpl: listed }).getBlocks()).toEqual([
      { blockId: "b1", displayName: "Bob", blockedAt: 1 },
    ]);
    expect(await createApiClient({ fetchImpl: added }).blockPlayer({ roomCode: "ABC234", seat: 1 })).toEqual({
      blockId: "b2",
      displayName: "Bob",
      blockedAt: 2,
    });
    expect(await createApiClient({ fetchImpl: removed }).unblockPlayer("a/b")).toBeUndefined();

    expect(listed.mock.calls[0][0]).toBe("/api/blocks");
    expect(added.mock.calls[0]).toEqual([
      "/api/blocks",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ roomCode: "ABC234", seat: 1 }) }),
    ]);
    expect(removed.mock.calls[0]).toEqual([
      "/api/blocks/a%2Fb",
      expect.objectContaining({ method: "DELETE" }),
    ]);
  });

  it("reads the leaderboard catalog and one board, with its limit", async () => {
    const boards = respond(200, { boards: [{ id: "overall" }] });
    const board = respond(200, { board: { id: "chess" }, entries: [] });
    const all = respond(200, { board: { id: "weekly" }, entries: [] });

    expect(await createApiClient({ fetchImpl: boards }).getLeaderboards()).toEqual([{ id: "overall" }]);
    expect(await createApiClient({ fetchImpl: board }).getLeaderboard("chess", { limit: 1 })).toEqual({
      board: { id: "chess" },
      entries: [],
    });
    await createApiClient({ fetchImpl: all }).getLeaderboard("weekly");
    expect(boards.mock.calls[0][0]).toBe("/api/leaderboards");
    expect(board.mock.calls[0][0]).toBe("/api/leaderboards/chess?limit=1");
    expect(all.mock.calls[0][0]).toBe("/api/leaderboards/weekly");
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

describe("api client, the account's data and age (CC-035, CC-152)", () => {
  it("reads the account and sets a birth year", async () => {
    const fetchImpl = respond(200, { account: { username: "riya", ageGroup: "adult" } });
    const api = createApiClient({ fetchImpl });

    expect(await api.getAccount()).toEqual({ username: "riya", ageGroup: "adult" });
    expect(await api.setBirthYear(1990)).toEqual({ username: "riya", ageGroup: "adult" });

    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ["/api/account", "GET", undefined],
      ["/api/account/birth-year", "PUT", JSON.stringify({ birthYear: 1990 })],
    ]);
  });

  it("asks for the data export and the deletion with the password", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ exportedAt: "2026-10-18" }) })
      .mockResolvedValueOnce({ status: 204, ok: true, json: async () => ({}) });
    const api = createApiClient({ fetchImpl });

    expect(await api.exportData("pw")).toEqual({ exportedAt: "2026-10-18" });
    expect(await api.deleteAccount("pw")).toBeUndefined();

    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ["/api/account/export", "POST", JSON.stringify({ password: "pw" })],
      ["/api/account/delete", "POST", JSON.stringify({ password: "pw" })],
    ]);
  });

  it("sends feedback and reads whether the form offers an email reply (CC-290)", async () => {
    const sent = respond(201, { feedback: { feedbackId: "f1", status: "new", createdAt: 1 } });
    const form = respond(200, { form: { replyEmail: true } });
    const body = { type: "bug", message: "Hi", page: "/", build: "dev", device: "phone" };

    expect(await createApiClient({ fetchImpl: sent }).sendFeedback(body)).toEqual({
      feedbackId: "f1",
      status: "new",
      createdAt: 1,
    });
    expect(await createApiClient({ fetchImpl: form }).getFeedbackForm()).toEqual({ replyEmail: true });

    expect(sent.mock.calls[0]).toEqual([
      "/api/feedback",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
    ]);
    expect(form.mock.calls[0][0]).toBe("/api/feedback/form");
  });

  it("reads one feedback item and deletes one (CC-290)", async () => {
    const read = respond(200, { item: { feedbackId: "a/b", replyEmail: "riya@example.com" } });
    const deleted = respond(204, undefined);

    expect(await createApiClient({ fetchImpl: read }).getFeedbackItem("a/b")).toEqual({
      feedbackId: "a/b",
      replyEmail: "riya@example.com",
    });
    expect(await createApiClient({ fetchImpl: deleted }).deleteFeedback("a/b")).toBeUndefined();

    expect(read.mock.calls[0][0]).toBe("/api/admin/feedback/a%2Fb");
    expect(deleted.mock.calls[0]).toEqual([
      "/api/admin/feedback/a%2Fb",
      expect.objectContaining({ method: "DELETE" }),
    ]);
  });

  it("reads the feedback inbox with its filters and changes an item's status (CC-290)", async () => {
    const listed = respond(200, { items: [], next: "1_x" });
    const changed = respond(200, { item: { feedbackId: "a/b", status: "done" } });
    const api = createApiClient({ fetchImpl: listed });

    expect(await api.getFeedbackInbox({ type: "bug", status: undefined, before: "1_x" })).toEqual({
      items: [],
      next: "1_x",
    });
    await api.getFeedbackInbox();
    expect(await createApiClient({ fetchImpl: changed }).setFeedbackStatus("a/b", "done")).toEqual({
      feedbackId: "a/b",
      status: "done",
    });

    expect(listed.mock.calls.map(([url]) => url)).toEqual([
      "/api/admin/feedback?type=bug&before=1_x",
      "/api/admin/feedback",
    ]);
    expect(changed.mock.calls[0]).toEqual([
      "/api/admin/feedback/a%2Fb",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "done" }) }),
    ]);
  });
});
