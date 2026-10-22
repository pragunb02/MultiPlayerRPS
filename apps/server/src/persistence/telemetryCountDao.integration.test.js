import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exampleTelemetryEvent } from "@classicade/shared/testing";
import { createTelemetryAccessor } from "../data/telemetryAccessor.js";
import { createTelemetryComponent } from "../domain/telemetry/telemetryComponent.js";
import { hasPlayerIdShape } from "../models/playerIdShape.js";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { countRow, runTelemetryCountDaoContract } from "../testing/telemetryCountDaoContract.js";
import { connectDatabase } from "./database.js";
import { createTelemetryCountDao, TELEMETRY_KEEP_DAYS } from "./telemetryCountDao.js";

let mongo;
const databases = [];
let counter = 0;

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await Promise.all(databases.map((db) => db.close()));
  await mongo?.stop();
});

async function createDao() {
  const database = await connectDatabase({
    uri: mongo.uri(`telemetry-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createTelemetryCountDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

const collection = () => databases.at(-1).connection.db.collection("telemetry_counts");
// 18:47:13 in India on 2026-10-20.
const ARRIVED = Date.UTC(2026, 9, 20, 13, 17, 13, 456);
const componentOn = (dao) =>
  createTelemetryComponent({
    telemetryAccessor: createTelemetryAccessor({ telemetryCountDao: dao }),
    now: () => ARRIVED,
    serverBuild: "2026.10.20+a40ce5b",
  });
const press = (control) => ({ ...exampleTelemetryEvent("control_pressed"), control });

describe("MongoDB telemetry count DAO honours the telemetry count DAO contract (integration)", () => {
  runTelemetryCountDaoContract(createDao);

  // AC-5 (CC-175), as the owner's review of 2026-10-21 decided: counters, not single events.
  it("stores no id and expires after 30 days", async () => {
    const dao = await createDao();

    await componentOn(dao).storeBatch({
      build: "0.1.0+abc1234",
      events: [press("home.play_guest"), exampleTelemetryEvent("page_viewed")],
    });

    const docs = await collection().find().toArray();
    expect(docs).toHaveLength(2);
    const pressed = docs.find(({ name }) => name === "control_pressed");
    expect(Object.keys(pressed).sort()).toEqual(
      [
        "_id",
        "key",
        "hour",
        "count",
        "build",
        "control",
        "device",
        "has_reason",
        "name",
        "player_kind",
        "route",
        "tier",
      ].sort(),
    );
    expect(pressed).toMatchObject({ tier: "counts", count: 1 });
    // The start of the India hour, 18:00 in India, which is 12:30 UTC: no minute, second or millisecond is kept.
    docs.forEach((doc) => expect(doc.hour).toEqual(new Date(Date.UTC(2026, 9, 20, 12, 30))));
    // A random id, not an ObjectId, which would hold the second the counter was made.
    docs.forEach((doc) => {
      expect(doc._id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(Object.values(doc).filter(hasPlayerIdShape)).toEqual([]);
    });
    expect(await collection().indexes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { hour: 1 }, expireAfterSeconds: TELEMETRY_KEEP_DAYS * 24 * 60 * 60 }),
        expect.objectContaining({ key: { hour: 1, key: 1 }, unique: true }),
      ]),
    );
    expect(TELEMETRY_KEEP_DAYS).toBe(30);
  });

  it("stores nothing per event or in order: one visit's batch and the same events in any order leave the same counters", async () => {
    const visit = [
      press("home.play_guest"),
      press("lobby.create"),
      press("home.play_guest"),
      press("room.leave"),
    ];
    const first = await createDao();
    await componentOn(first).storeBatch({ build: "0.1.0+abc1234", events: visit });
    const one = await collection()
      .find({}, { projection: { _id: 0 } })
      .toArray();

    const second = await createDao();
    const component = componentOn(second);
    for (const event of [...visit].reverse()) {
      await component.storeBatch({ build: "0.1.0+abc1234", events: [event] });
    }
    const other = await collection()
      .find({}, { projection: { _id: 0 } })
      .toArray();

    // Three counters for four presses: the repeated press is a count of 2, not a second document.
    expect(one).toHaveLength(3);
    const byKey = (docs) => [...docs].sort((a, b) => a.key.localeCompare(b.key));
    expect(byKey(other)).toEqual(byKey(one));
    expect(one.find(({ control }) => control === "home.play_guest").count).toBe(2);
    // Nothing says which events arrived together, or in which order: no batch, sequence or arrival time.
    one.forEach((doc) => {
      expect(
        Object.keys(doc).filter((key) => /batch|seq|order|received|created|updated|at$/i.test(key)),
      ).toEqual([]);
    });
    // What the database hands back is in counter order, never in the order the events came in.
    const listed = await second.list({ from: new Date(0), to: new Date(Date.UTC(2100, 0)), limit: 10 });
    expect(listed.map(({ control }) => control)).toEqual(
      [...listed.map(({ control }) => control)].sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
    );
  });

  it("refuses a key the catalogue does not have, even if one got past the validator", async () => {
    const dao = await createDao();
    const row = countRow();

    await expect(
      dao.addCounts([{ ...row, fields: { ...row.fields, player_id: "user_0123456789abcdef01234567" } }]),
    ).rejects.toThrow();
    expect(await collection().countDocuments()).toBe(0);
  });

  it("writes only to the new `telemetry_counts` collection", async () => {
    const dao = await createDao();
    await dao.addCounts([countRow()]);

    const names = (await databases.at(-1).connection.db.listCollections().toArray()).map((c) => c.name);
    expect(names).toEqual(["telemetry_counts"]);
  });
});
