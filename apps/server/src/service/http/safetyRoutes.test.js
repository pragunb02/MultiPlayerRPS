import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { safetyFromAdults } from "../../testing/fakeSafety.js";
import { errorHandler, notFoundHandler } from "./errorMiddleware.js";
import { createSafetyRoutes } from "./safetyRoutes.js";

const NOW = Date.parse("2026-10-20T06:00:00.000Z");
const ADULT = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Riya" };
const NO_YEAR = { kind: "user", id: "user_000000000000000000000001", displayName: "Arjun" };
const GUEST = { kind: "guest", id: "guest_00000000-0000-4000-8000-000000000001", displayName: "Guest-T001" };
const QUIET = { timeZone: "Asia/Kolkata", from: "22:00", to: "07:00" };

function app() {
  const asked = [];
  const server = express();
  server.use((req, res, next) => {
    const who = req.get("X-Test-Identity");
    req.session = who === undefined ? {} : { identity: JSON.parse(who) };
    next();
  });
  const safety = safetyFromAdults(({ playerIds, now }) => {
    asked.push({ playerIds, now });
    return playerIds.filter((id) => id === ADULT.id);
  });
  server.use("/api", createSafetyRoutes({ safetyComponent: safety, now: () => NOW }));
  server.use(notFoundHandler);
  server.use(errorHandler);
  return { server, asked };
}

const get = (server, identity) => {
  const req = request(server).get("/api/safety");
  return identity === undefined ? req : req.set("X-Test-Identity", JSON.stringify(identity));
};

const MINOR_FLAGS = {
  canFollow: false,
  friendsMode: "mutual-known",
  emotes: "off",
  quietHours: QUIET,
  shareCardName: false,
  maxOwnedCircleSize: 10,
  publicProfile: false,
  boardName: "hidden",
};

describe("GET /safety: the player's own age policy flags (CC-152)", () => {
  it("gives an adult account the adult flags, read for that player at that moment", async () => {
    const { server, asked } = app();

    const res = await get(server, ADULT);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      safety: {
        canFollow: true,
        friendsMode: "mutual",
        emotes: "on",
        quietHours: null,
        shareCardName: true,
        maxOwnedCircleSize: 50,
        publicProfile: true,
        boardName: "own",
      },
    });
    expect(asked).toEqual([{ playerIds: [ADULT.id], now: NOW }]);
  });

  it("gives an account of unknown age the minor's flags (ADR-028.1), never its age group", async () => {
    const res = await get(app().server, NO_YEAR);

    expect(res.body).toEqual({ safety: MINOR_FLAGS });
    expect(JSON.stringify(res.body)).not.toMatch(/minor|adult|unknown|birth/i);
  });

  it("gives a guest no friends and its server-given name, and a visitor the safest flags", async () => {
    const { server, asked } = app();

    expect((await get(server, GUEST)).body).toEqual({
      safety: { ...MINOR_FLAGS, friendsMode: "none", boardName: "server-given" },
    });
    expect((await get(server)).body).toEqual({ safety: MINOR_FLAGS });
    expect(asked).toEqual([]);
  });
});
