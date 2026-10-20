import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exampleTelemetryEvent } from "@classicade/shared/testing";
import { createTelemetryAccessor } from "../data/telemetryAccessor.js";
import { createTelemetryComponent } from "../domain/telemetry/telemetryComponent.js";
import { hasPlayerIdShape } from "../models/playerIdShape.js";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { runTelemetryEventDaoContract, storedEvent } from "../testing/telemetryEventDaoContract.js";
import { connectDatabase } from "./database.js";
import { createTelemetryEventDao, TELEMETRY_KEEP_DAYS } from "./telemetryEventDao.js";

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
  const dao = createTelemetryEventDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

const collection = () => databases.at(-1).connection.db.collection("telemetry_events");

describe("MongoDB telemetry event DAO honours the telemetry event DAO contract (integration)", () => {
  runTelemetryEventDaoContract(createDao);

  // AC-5 (CC-175)
  it("stores no id and expires after 30 days", async () => {
    const dao = await createDao();
    // 18:47:13 in India on 2026-10-20.
    const arrived = Date.UTC(2026, 9, 20, 13, 17, 13, 456);
    const component = createTelemetryComponent({
      telemetryAccessor: createTelemetryAccessor({ telemetryEventDao: dao }),
      now: () => arrived,
      serverBuild: "2026.10.20+a40ce5b",
    });

    await component.storeBatch({
      build: "0.1.0+abc1234",
      events: [exampleTelemetryEvent("control_pressed"), exampleTelemetryEvent("page_viewed")],
    });

    const docs = await collection().find().toArray();
    expect(docs).toHaveLength(2);
    const pressed = docs.find(({ name }) => name === "control_pressed");
    expect(Object.keys(pressed).sort()).toEqual(
      [
        "_id",
        "build",
        "control",
        "device",
        "has_reason",
        "name",
        "player_kind",
        "received_at",
        "route",
        "tier",
      ].sort(),
    );
    expect(pressed.tier).toBe("counts");
    // The start of the India hour, 18:00 in India, which is 12:30 UTC: no minute, second or millisecond is kept.
    docs.forEach((doc) => expect(doc.received_at).toEqual(new Date(Date.UTC(2026, 9, 20, 12, 30))));
    // A random id, not an ObjectId, which would hold the second the event arrived.
    docs.forEach((doc) => {
      expect(typeof doc._id).toBe("string");
      expect(doc._id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(Object.values(doc).filter(hasPlayerIdShape)).toEqual([]);
    });

    expect(await collection().indexes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { received_at: 1 },
          expireAfterSeconds: TELEMETRY_KEEP_DAYS * 24 * 60 * 60,
        }),
      ]),
    );
    expect(TELEMETRY_KEEP_DAYS).toBe(30);
  });

  it("refuses a key the catalogue does not have, even if one got past the validator", async () => {
    const dao = await createDao();

    await expect(
      dao.insertMany([{ ...storedEvent(), player_id: "user_0123456789abcdef01234567" }]),
    ).rejects.toThrow();
    expect(await collection().countDocuments()).toBe(0);
  });

  it("writes only to the new `telemetry_events` collection", async () => {
    const dao = await createDao();
    await dao.insertMany([storedEvent()]);

    const names = (await databases.at(-1).connection.db.listCollections().toArray()).map((c) => c.name);
    expect(names).toEqual(["telemetry_events"]);
  });
});
