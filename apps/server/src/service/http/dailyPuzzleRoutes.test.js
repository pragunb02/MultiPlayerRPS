import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import { createInMemoryDailyPuzzleAttemptDao } from "../../testing/inMemoryDailyPuzzleAttemptDao.js";
import { clockOn, startTestServer } from "../../testing/testApp.js";
import { createDailyPuzzleRoutes } from "./dailyPuzzleRoutes.js";
import { errorHandler } from "./errorMiddleware.js";

// CC-144, ADR-061: the daily chess puzzle over HTTP. The test set gives Tuesday 2026-10-20 the two-move puzzle
// 0000D: Black finds Rd8 (f8d8), White takes Qxd8+, Black finds Bxd8 (f6d8).
let server;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const TUESDAY = "2026-10-20";
const PASSWORD = "correct horse battery";

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(`${server.baseUrl}/api${path}`, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { cookie }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const setCookie = res.headers.get("set-cookie");
  return {
    status: res.status,
    headers: res.headers,
    body: text === "" ? {} : JSON.parse(text),
    cookie: setCookie ? setCookie.split(";")[0] : cookie,
  };
}

const start = (options = {}) => startTestServer({ now: clockOn(TUESDAY), ...options });
const guest = async () => (await call("POST", "/session/guest")).cookie;
const move = (cookie, squares, day = TUESDAY) =>
  call("POST", "/daily/chess/moves", { body: { day, ...squares }, cookie });
const hint = (cookie, day = TUESDAY) => call("POST", "/daily/chess/hints", { body: { day }, cookie });
const reasonOf = (res) => res.body.error?.details?.reason;

describe("GET /api/daily/chess (CC-144)", () => {
  it("shows a visitor today's puzzle without the solution, and is never cached", async () => {
    server = await start();

    const res = await call("GET", "/daily/chess");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.body.puzzle).toMatchObject({
      kind: "chess",
      day: TUESDAY,
      number: 2,
      status: "new",
      position: { toMove: "b", lastMove: { san: "Qd6" } },
      streak: { current: 0 },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/f8d8|f6d8|Rd8|Bxd8|0000D/);
  });

  it("is not found for a kind there is no puzzle of", async () => {
    server = await start();

    const res = await call("GET", "/daily/sudoku");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it("shows a guest their own attempt", async () => {
    server = await start();
    const cookie = await guest();
    await move(cookie, { from: "g8", to: "h8" });

    const res = await call("GET", "/daily/chess", { cookie });

    expect(res.body.puzzle).toMatchObject({ status: "playing", mistakes: 1 });
  });
});

describe("POST /api/daily/chess/moves (CC-144)", () => {
  it("answers a correct move with the reply and the solved puzzle with its solution", async () => {
    server = await start();
    const cookie = await guest();

    const first = await move(cookie, { from: "f8", to: "d8" });
    const last = await move(cookie, { from: "f6", to: "d8" });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ outcome: "correct", reply: { from: "d6", to: "d8", san: "Qxd8+" } });
    expect(JSON.stringify(first.body)).not.toMatch(/f6d8|Bxd8/);
    expect(last.body).toMatchObject({
      outcome: "solved",
      puzzle: { status: "solved", solution: ["Rd8", "Qxd8+", "Bxd8"], streak: { current: 1 } },
    });
    expect(server.find("daily puzzle move").map(({ outcome }) => outcome)).toEqual(["correct", "solved"]);
  });

  it("needs a session", async () => {
    server = await start();

    const res = await move(undefined, { from: "f8", to: "d8" });

    expect(res.status).toBe(401);
  });

  it("refuses an illegal move with 400 and no mistake", async () => {
    server = await start();
    const cookie = await guest();

    const res = await move(cookie, { from: "f8", to: "f1" });

    expect(res.status).toBe(400);
    expect(reasonOf(res)).toBe("illegalMove");
    expect((await call("GET", "/daily/chess", { cookie })).body.puzzle.mistakes).toBe(0);
  });

  it.each([
    ["no object", ["f8d8"]],
    ["an unknown field", { day: TUESDAY, from: "f8", to: "d8", solution: true }],
    ["no day", { from: "f8", to: "d8" }],
    ["a day that does not exist", { day: "2026-02-30", from: "f8", to: "d8" }],
    ["a square off the board", { day: TUESDAY, from: "f9", to: "d8" }],
    ["a target that is not a square", { day: TUESDAY, from: "f8", to: 4 }],
    ["an unknown promotion", { day: TUESDAY, from: "f8", to: "d8", promotion: "k" }],
  ])("refuses %s with 400", async (_, body) => {
    server = await start();
    const cookie = await guest();

    const res = await call("POST", "/daily/chess/moves", { body, cookie });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("takes a promotion piece, which a move that promotes nothing ignores", async () => {
    server = await start();
    const cookie = await guest();

    const res = await move(cookie, { from: "f8", to: "d8", promotion: "q" });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("correct");
  });

  it("refuses a move for yesterday's puzzle with 409", async () => {
    server = await start();
    const cookie = await guest();

    const res = await move(cookie, { from: "f8", to: "d8" }, "2026-10-19");

    expect(res.status).toBe(409);
    expect(reasonOf(res)).toBe("dayOver");
  });

  it("refuses a move once the attempt has ended", async () => {
    server = await start();
    const cookie = await guest();
    for (let i = 0; i < 3; i += 1) await move(cookie, { from: "g8", to: "h8" });

    const res = await move(cookie, { from: "f8", to: "d8" });

    expect(res.status).toBe(409);
    expect(reasonOf(res)).toBe("finished");
  });

  it("refuses a change another tab made at the same moment", async () => {
    const dailyPuzzleAttemptDao = createInMemoryDailyPuzzleAttemptDao();
    server = await start({ dailyPuzzleAttemptDao });
    const cookie = await guest();
    await move(cookie, { from: "g8", to: "h8" });
    dailyPuzzleAttemptDao.failNextUpdate();

    const res = await move(cookie, { from: "f8", to: "d8" });

    expect(res.status).toBe(409);
    expect(reasonOf(res)).toBe("changed");
  });

  it("limits moves and hints per player", async () => {
    server = await start({ dailyPuzzleLimit: { windowMs: 60_000, limit: 2 } });
    const cookie = await guest();
    await hint(cookie);
    await move(cookie, { from: "g8", to: "h8" });

    const res = await move(cookie, { from: "g8", to: "h8" });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });
});

describe("POST /api/daily/chess/hints (CC-144)", () => {
  it("gives two hints and then refuses with 409", async () => {
    server = await start();
    const cookie = await guest();

    const first = await hint(cookie);
    const second = await hint(cookie);
    const third = await hint(cookie);

    expect(first.body.hint).toBe("Look for a way to win material.");
    expect(second.body.hint).toBe("Move your rook on f8.");
    expect(third.status).toBe(409);
    expect(reasonOf(third)).toBe("noHintsLeft");
  });

  it("needs a session and a day", async () => {
    server = await start();
    const cookie = await guest();

    expect((await hint(undefined)).status).toBe(401);
    expect((await call("POST", "/daily/chess/hints", { body: {}, cookie })).status).toBe(400);
  });
});

describe("daily puzzle days follow a guest who signs up, and go with a deleted account (ADR-014, ADR-048)", () => {
  it("moves the guest's solved day to the new account, then exports and erases it", async () => {
    server = await start();
    const cookie = await guest();
    await move(cookie, { from: "f8", to: "d8" });
    await move(cookie, { from: "f6", to: "d8" });

    const account = await call("POST", "/auth/signup", {
      body: { username: "Riya", email: "riya@example.com", password: PASSWORD },
      cookie,
    });
    const today = await call("GET", "/daily/chess", { cookie: account.cookie });
    const exported = await call("POST", "/account/export", {
      body: { password: PASSWORD },
      cookie: account.cookie,
    });
    const deleted = await call("POST", "/account/delete", {
      body: { password: PASSWORD },
      cookie: account.cookie,
    });

    expect(today.body.puzzle).toMatchObject({ status: "solved", streak: { current: 1 } });
    expect(exported.body.dailyPuzzles).toEqual([expect.objectContaining({ day: TUESDAY, status: "solved" })]);
    expect(deleted.status).toBe(204);
    expect(await server.dailyPuzzleComponent.exportPlayer({ playerId: account.body.identity.id })).toEqual(
      [],
    );
  });
});

describe("the daily puzzle routes on their own", () => {
  it("are not found for a kind the component knows but no request parser does", async () => {
    const app = express();
    app.use(
      createDailyPuzzleRoutes({
        dailyPuzzleComponent: { hasKind: () => true },
        now: () => 0,
      }),
    );
    app.use(errorHandler);
    const listening = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => listening.once("listening", resolve));

    const res = await fetch(`http://127.0.0.1:${listening.address().port}/daily/sudoku`);

    expect(res.status).toBe(404);
    await new Promise((resolve) => listening.close(resolve));
  });
});
