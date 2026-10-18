import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "./server.js";
import { matchDoc, playerId } from "./testing/analyticsFixtures.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { TEST_WEB_BUILD, testConfig } from "./testing/testConfig.js";

// The owner console through the real composition root, MongoDB and HTTP stack (CC-233). The owner signs up
// first, then the server restarts with their id in ADMIN_ACCOUNT_IDS, as the owner does on Render. Sessions are
// stored in MongoDB, so everyone stays signed in across the restart.

const ORIGIN = "http://localhost:5173";
const RANGE = "from=2025-03-03&to=2025-03-09";
const guests = Array.from({ length: 6 }, (_, index) => playerId("guest", index + 1));
const users = [playerId("user", 1), playerId("user", 2)];

/** A week of play: 6 guests on Monday, Wednesday and Friday (India time), and 2 accounts once on Tuesday. */
function seedWeek() {
  const pairs = [
    [guests[0], guests[1]],
    [guests[2], guests[3]],
    [guests[4], guests[5]],
  ];
  return [
    // The last second of Sunday 2 March in India: in the week before the range.
    matchDoc({ playerIds: pairs[0], endedAt: "2025-03-02T18:29:59.000Z" }),
    // The first second of Monday 3 March in India: inside the range.
    matchDoc({ playerIds: pairs[0], endedAt: "2025-03-02T18:30:00.000Z" }),
    matchDoc({ playerIds: pairs[1], endedAt: "2025-03-03T14:00:00.000Z" }),
    matchDoc({ playerIds: pairs[2], endedAt: "2025-03-03T14:30:00.000Z" }),
    ...["2025-03-05", "2025-03-07"].flatMap((day) =>
      pairs.map((pair) => matchDoc({ playerIds: pair, endedAt: `${day}T14:00:00.000Z` })),
    ),
    matchDoc({ gameId: "chess", playerIds: users, endedAt: "2025-03-04T15:00:00.000Z", seconds: 900 }),
  ];
}

let mongo;
let uri;
let server;
const people = {};

async function signUp(url, name) {
  const res = await fetch(`${url}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ username: name, email: `${name}@example.com`, password: `${name} long password` }),
  });
  return { cookie: res.headers.get("set-cookie").split(";")[0], identity: (await res.json()).identity };
}

async function start(env) {
  const config = testConfig({
    MONGO_URI: uri,
    WEB_DIST_DIR: TEST_WEB_BUILD,
    ALLOWED_ORIGINS: ORIGIN,
    ...env,
  });
  const app = await startServer({ config, logger: captureLogger().logger });
  return { ...app, url: `http://127.0.0.1:${app.port}` };
}

beforeAll(async () => {
  mongo = await startMemoryMongo();
  uri = mongo.uri("admin-console");
  const first = await start({});
  people.owner = await signUp(first.url, "owner");
  people.player = await signUp(first.url, "riya");
  const guest = await fetch(`${first.url}/api/session/guest`, {
    method: "POST",
    headers: { Origin: ORIGIN },
  });
  people.guest = { cookie: guest.headers.get("set-cookie").split(";")[0] };
  await first.close();

  const connection = await mongoose.createConnection(uri).asPromise();
  await connection.collection("matches").insertMany(seedWeek());
  await connection.close();

  server = await start({ ADMIN_ACCOUNT_IDS: people.owner.identity.id });
}, 120_000);

afterAll(async () => {
  await server?.close();
  await mongo?.stop();
});

const get = (path, person, accept = "application/json") =>
  fetch(`${server.url}${path}`, { headers: { Accept: accept, ...(person && { cookie: person.cookie }) } });

describe("owner console (integration)", () => {
  it("tells only the owner's session that the console is theirs", async () => {
    expect(await (await get("/api/session", people.owner)).json()).toEqual(
      expect.objectContaining({ authenticated: true, admin: true }),
    );
    expect(await (await get("/api/session", people.player)).json()).not.toHaveProperty("admin");
    expect(await (await get("/api/session", people.guest)).json()).not.toHaveProperty("admin");
  });

  it("answers anyone but the owner with the same 404 as an unknown address, for the API and the page", async () => {
    const unknown = await (await get("/api/nothing-here", people.player)).json();
    for (const person of [undefined, people.guest, people.player]) {
      const api = await get(`/api/admin/analytics?${RANGE}`, person);
      const page = await get("/admin", person, "text/html");

      expect(api.status).toBe(404);
      expect({ ...(await api.json()).error, requestId: "" }).toEqual({ ...unknown.error, requestId: "" });
      expect(page.status).toBe(404);
      expect(await page.text()).toContain("Page not found · ClassiCade");
    }
  });

  it("serves the owner the console page, not listed by search engines", async () => {
    const page = await get("/admin/retention", people.owner, "text/html");

    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await page.text()).toContain("Owner console · ClassiCade");
  });

  it("gives the owner totals that match the seeded week, counted in India days", async () => {
    const res = await get(`/api/admin/analytics?${RANGE}`, people.owner);
    const { report } = await res.json();
    const headlines = Object.fromEntries(report.overview.headlines.map(({ id, value }) => [id, value]));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(headlines).toEqual(
      expect.objectContaining({ activePlayers: 8, matches: 10, newPlayers: 6, weeklyReturning: 6 }),
    );
    expect(report.overview.headlines.find(({ id }) => id === "matches")).toEqual({
      id: "matches",
      value: 10,
      previous: 1,
      change: 9,
    });
    expect(report.games.popularity.slice(0, 2)).toEqual([
      { gameId: "rps", matches: 9, share: 0.9 },
      { gameId: "chess", matches: 1, share: 0.1 },
    ]);
    expect(report.players.weeklyReturning).toEqual([
      { week: "2025-03-03", complete: true, players: 6, withPerson: 1, accounts: 0 },
    ]);
    // The first pair started on Sunday 2 March, India time, so on Sunday 9 March that is 8 days back: no
    // longer New but Regular. Everyone else started inside the week and is still New.
    expect(report.statuses.weeks).toEqual([
      expect.objectContaining({ week: "2025-03-03", new: 6, regular: "<5", core: 0, northStar: "<5" }),
    ]);
  });

  it("hides every group of 1 to 4 people, and never sends an id, a name or a room code", async () => {
    const { report } = await (await get(`/api/admin/analytics?${RANGE}`, people.owner)).json();

    expect(report.players.kinds).toEqual({ guests: 6, accounts: "<5", guestShare: 0.75 });
    expect(report.players.active.find(({ bucket }) => bucket === "2025-03-04")).toEqual({
      bucket: "2025-03-04",
      players: "<5",
      guests: 0,
      accounts: "<5",
    });
    expect(JSON.stringify(report)).not.toMatch(/guest_|user_|owner|riya|Player-|R\d{5}/);
  });

  it("refuses a range that runs backwards", async () => {
    const res = await get("/api/admin/analytics?from=2025-03-09&to=2025-03-03", people.owner);

    expect(res.status).toBe(400);
  });
});
