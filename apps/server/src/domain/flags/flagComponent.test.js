import { describe, expect, it } from "vitest";
import { FLAG_AUDIENCES, FLAG_ROLLOUT } from "@classicade/shared";
import { createFeatureFlagAccessor } from "../../data/featureFlagAccessor.js";
import { captureLogger } from "../../testing/captureLogger.js";
import { createInMemoryFeatureFlagDao } from "../../testing/inMemoryFeatureFlagDao.js";
import { createKeyedIds } from "../../utils/keyedIds.js";
import { CONSOLE_DAYS, COUNTS_KEEP_DAYS, createFlagComponent, OVERRIDES_STALE_MS } from "./flagComponent.js";

// The server's feature flags (CC-312, ADR-073): who gets a flag, the owner's overrides with a fallback when the
// database is away, and anonymous counts.
const T0 = Date.UTC(2026, 9, 20, 6, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

const flag = (fields) =>
  Object.freeze({
    name: "new_lobby",
    description: "The new lobby.",
    ticket: "CC-400",
    default: false,
    removeBy: "2026-12-31",
    rollout: FLAG_ROLLOUT.OFF,
    audience: FLAG_AUDIENCES.EVERYONE,
    client: true,
    success: "A room is made from the new lobby.",
    ...fields,
  });
const REGISTRY = Object.freeze([
  flag({}),
  flag({ name: "server_only", client: false, rollout: FLAG_ROLLOUT.ON }),
  flag({ name: "adults_only", audience: FLAG_AUDIENCES.ADULTS, rollout: FLAG_ROLLOUT.ON }),
  flag({ name: "owner_only", audience: FLAG_AUDIENCES.ADMINS, rollout: FLAG_ROLLOUT.ON }),
]);

const GUEST = Object.freeze({ id: "guest_1", kind: "guest", admin: false });
const ACCOUNT = Object.freeze({ id: "user_1", kind: "user", admin: false });
const ADULT = Object.freeze({ id: "user_2", kind: "user", admin: false });
const ADMIN = Object.freeze({ id: "user_3", kind: "user", admin: true });

/** A DAO whose every call fails while `down` is true, as when the database is unreachable. */
function flakyDao() {
  const dao = createInMemoryFeatureFlagDao();
  const state = { down: false };
  const guarded = Object.fromEntries(
    Object.entries(dao).map(([key, fn]) => [
      key,
      async (...args) => {
        if (state.down) throw new Error("database unreachable");
        return fn(...args);
      },
    ]),
  );
  return { dao: Object.freeze(guarded), state };
}

function setup({ registry = REGISTRY, adults = [ADULT.id], ages } = {}) {
  let clock = T0;
  const { dao, state } = flakyDao();
  const capture = captureLogger();
  const flags = createFlagComponent({
    registry,
    flagAccessor: createFeatureFlagAccessor({ featureFlagDao: dao }),
    keyedIds: createKeyedIds({ secret: "a test key for feature flag buckets, 32+ chars" }),
    ages: ages ?? {
      adultsAmong: async ({ playerIds }) => new Set(playerIds.filter((id) => adults.includes(id))),
    },
    logger: capture.logger,
    now: () => clock,
  });
  return {
    flags,
    dao,
    state,
    capture,
    tick: (ms) => {
      clock += ms;
    },
  };
}

const players = Array.from({ length: 400 }, (_, index) => ({
  id: `guest_${index}`,
  kind: "guest",
  admin: false,
}));

describe("flag component: who gets a flag (CC-312)", () => {
  it("checks the registry when it is made, so a broken registry stops the boot", () => {
    expect(() => setup({ registry: [flag({ removeBy: "soon" })] })).toThrow(/removeBy/);
  });

  it("needs its dependencies", () => {
    expect(() => createFlagComponent({})).toThrow();
  });

  it("an unknown flag name throws, in isOn and in recordSuccess", async () => {
    const { flags } = setup();

    await expect(flags.isOn("no_such_flag", GUEST)).rejects.toThrow(/Unknown feature flag "no_such_flag"/);
    await expect(flags.recordSuccess("no_such_flag", GUEST)).rejects.toThrow(RangeError);
  });

  it("answers the code's rollout before any override: off is off, on is on", async () => {
    const { flags } = setup();

    expect(await flags.isOn("new_lobby", GUEST)).toBe(false);
    expect(await flags.isOn("server_only", GUEST)).toBe(true);
    expect(await flags.isOn("server_only", undefined)).toBe(true);
  });

  it("keeps players outside the audience out, whatever the rollout", async () => {
    const { flags } = setup();

    expect(await flags.isOn("adults_only", GUEST)).toBe(false);
    expect(await flags.isOn("adults_only", ACCOUNT)).toBe(false);
    expect(await flags.isOn("adults_only", ADULT)).toBe(true);
    expect(await flags.isOn("owner_only", ACCOUNT)).toBe(false);
    expect(await flags.isOn("owner_only", ADMIN)).toBe(true);
  });

  it("does not ask the age rule for a guest or a visitor, and answers the flag's default when the rule fails", async () => {
    let asked = 0;
    const { flags, capture } = setup({
      ages: {
        adultsAmong: async () => {
          asked += 1;
          throw new Error("account store down");
        },
      },
    });

    expect(await flags.isOn("adults_only", GUEST)).toBe(false);
    expect(await flags.isOn("adults_only", undefined)).toBe(false);
    expect(asked).toBe(0);
    expect(await flags.isOn("adults_only", ADULT)).toBe(false);
    expect(asked).toBe(1);
    expect(capture.find("feature flag not worked out, default used")).toHaveLength(1);
  });

  it("applies an override set by the owner at once, and the code's rollout again when it is cleared", async () => {
    const { flags } = setup();

    await flags.setRollout({ name: "new_lobby", rollout: FLAG_ROLLOUT.ON });
    expect(await flags.isOn("new_lobby", GUEST)).toBe(true);

    expect(await flags.clearRollout({ name: "new_lobby" })).toBe(true);
    expect(await flags.isOn("new_lobby", GUEST)).toBe(false);
    expect(await flags.clearRollout({ name: "new_lobby" })).toBe(false);
  });

  it("refuses to set an unknown flag or a rollout that is not off, on or 0 to 100", async () => {
    const { flags } = setup();

    await expect(flags.setRollout({ name: "no_such_flag", rollout: "on" })).rejects.toThrow(
      /Unknown feature flag/,
    );
    await expect(flags.clearRollout({ name: "no_such_flag" })).rejects.toThrow(/Unknown feature flag/);
    await expect(flags.setRollout({ name: "new_lobby", rollout: 150 })).rejects.toThrow(/rollout/);
  });

  it("puts about the asked share of players on, and only adds players as the owner ramps up", async () => {
    const { flags } = setup();
    const onAt = async (rollout) => {
      await flags.setRollout({ name: "new_lobby", rollout });
      const answers = await Promise.all(players.map((player) => flags.isOn("new_lobby", player)));
      return new Set(players.filter((_, index) => answers[index]).map(({ id }) => id));
    };

    const ten = await onAt(10);
    const fifty = await onAt(50);

    expect(ten.size / players.length).toBeGreaterThan(0.05);
    expect(ten.size / players.length).toBeLessThan(0.15);
    expect([...ten].every((id) => fifty.has(id))).toBe(true);
    expect(await onAt(10)).toEqual(ten);
  });

  it("reads overrides another process stored when it refreshes, and ignores names no longer in the registry", async () => {
    const { flags, dao, capture } = setup();
    await dao.setOverride({ name: "new_lobby", rollout: "on", updatedAt: new Date(T0) });
    await dao.setOverride({ name: "removed_flag", rollout: "on", updatedAt: new Date(T0) });
    await dao.setOverride({ name: "server_only", rollout: "maybe", updatedAt: new Date(T0) });

    expect(await flags.isOn("new_lobby", GUEST)).toBe(false);
    await flags.refresh();

    expect(await flags.isOn("new_lobby", GUEST)).toBe(true);
    expect(await flags.isOn("server_only", GUEST)).toBe(true);
    expect(capture.find("feature flag override ignored").map((entry) => entry.flag)).toEqual([
      "removed_flag",
      "server_only",
    ]);
  });

  it("falls back to the code's rollout when the database stays down, keeping the last good overrides for a while", async () => {
    const { flags, dao, state, tick, capture } = setup();
    await dao.setOverride({ name: "new_lobby", rollout: "on", updatedAt: new Date(T0) });
    await flags.refresh();

    state.down = true;
    tick(OVERRIDES_STALE_MS - 1000);
    await flags.refresh();
    expect(await flags.isOn("new_lobby", GUEST)).toBe(true);
    expect((await flags.overview()).source).toBe("database");

    tick(2000);
    await flags.refresh();
    expect(await flags.isOn("new_lobby", GUEST)).toBe(false);
    expect(capture.find("feature flag overrides not read")).toHaveLength(2);

    state.down = false;
    await flags.refresh();
    expect(await flags.isOn("new_lobby", GUEST)).toBe(true);
  });

  it("uses the code's rollout when the database was never read", async () => {
    const { flags, state } = setup();
    state.down = true;

    await flags.refresh();

    expect(await flags.isOn("server_only", GUEST)).toBe(true);
    expect(await flags.isOn("new_lobby", GUEST)).toBe(false);
  });

  it("answers the client only the booleans of client flags", async () => {
    const { flags } = setup();

    expect(flags.isClientFlag("new_lobby")).toBe(true);
    expect(flags.isClientFlag("server_only")).toBe(false);
    expect(flags.isClientFlag("no_such_flag")).toBe(false);
    expect(await flags.resolve(["new_lobby", "owner_only"], ADMIN)).toEqual({
      new_lobby: false,
      owner_only: true,
    });
  });
});

describe("flag component: anonymous counts (CC-312)", () => {
  it("counts each answer as an exposure and each success on the side the player is on, with no id", async () => {
    const { flags, dao } = setup();
    await flags.setRollout({ name: "new_lobby", rollout: "on" });

    for (const player of players.slice(0, 6)) {
      await flags.isOn("new_lobby", player);
    }
    await flags.recordSuccess("new_lobby", players[0]);
    await flags.isOn("server_only", GUEST);
    await flags.flush();

    expect(await dao.countsSince("2026-10-01")).toEqual(
      expect.arrayContaining([
        { flag: "new_lobby", side: "on", exposures: 6, successes: 1 },
        { flag: "server_only", side: "on", exposures: 1, successes: 0 },
      ]),
    );
  });

  it("counts are anonymous and small groups are hidden: 1 to 4 becomes <5, zero stays zero", async () => {
    const { flags } = setup();
    for (const player of players.slice(0, 7)) {
      await flags.isOn("new_lobby", player);
    }
    await flags.recordSuccess("new_lobby", players[0]);

    const { flags: listed } = await flags.overview();
    const lobby = listed.find(({ name }) => name === "new_lobby");

    expect(lobby.counts).toEqual({
      on: { exposures: 0, successes: 0 },
      off: { exposures: 7, successes: "<5" },
    });
    expect(JSON.stringify(lobby)).not.toMatch(/guest_|user_/);
  });

  it("keeps counts in memory until a write works, so a database blip loses none", async () => {
    const { flags, dao, state, capture } = setup();
    await flags.isOn("new_lobby", GUEST);
    state.down = true;

    await flags.flush();
    expect(capture.find("feature flag counts not written")).toHaveLength(1);
    await flags.isOn("new_lobby", GUEST);
    state.down = false;
    await flags.flush();
    await flags.flush();

    expect(await dao.countsSince("2026-10-01")).toEqual([
      { flag: "new_lobby", side: "off", exposures: 2, successes: 0 },
    ]);
  });

  it("adds counts made while a failed write was on its way to the ones it keeps", async () => {
    let fail;
    const flags = createFlagComponent({
      registry: REGISTRY,
      flagAccessor: {
        ...createFeatureFlagAccessor({ featureFlagDao: createInMemoryFeatureFlagDao() }),
        addCounts: () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      },
      keyedIds: createKeyedIds({ secret: "a test key for feature flag buckets, 32+ chars" }),
      ages: { adultsAmong: async () => new Set() },
      logger: captureLogger().logger,
      now: () => T0,
    });
    for (const player of players.slice(0, 5)) {
      await flags.isOn("new_lobby", player);
    }

    const writing = flags.flush();
    await flags.isOn("new_lobby", GUEST);
    fail(new Error("database unreachable"));
    await writing;

    const { flags: listed } = await flags.overview();
    expect(listed.find(({ name }) => name === "new_lobby").counts.off.exposures).toBe(6);
  });

  it("leaves counts older than CONSOLE_DAYS out of the console", async () => {
    const { flags, tick } = setup();
    await flags.isOn("new_lobby", GUEST);
    await flags.flush();
    tick((CONSOLE_DAYS + 10) * DAY_MS);
    await flags.isOn("new_lobby", GUEST);

    const view = await flags.overview();

    expect(view.days).toBe(CONSOLE_DAYS);
    expect(view.flags.find(({ name }) => name === "new_lobby").counts.off.exposures).toBe("<5");
  });

  it("counts by India day and keeps each day for COUNTS_KEEP_DAYS", async () => {
    const rows = [];
    const flags = createFlagComponent({
      registry: REGISTRY,
      flagAccessor: {
        ...createFeatureFlagAccessor({ featureFlagDao: createInMemoryFeatureFlagDao() }),
        addCounts: async (each) => {
          rows.push(...each);
        },
      },
      keyedIds: createKeyedIds({ secret: "a test key for feature flag buckets, 32+ chars" }),
      ages: { adultsAmong: async () => new Set() },
      logger: captureLogger().logger,
      // 19:00 UTC on 20 October is half past midnight on 21 October in India.
      now: () => Date.UTC(2026, 9, 20, 19),
    });

    await flags.isOn("new_lobby", GUEST);
    await flags.flush();

    expect(rows).toEqual([
      {
        flag: "new_lobby",
        day: "2026-10-21",
        side: "off",
        exposures: 1,
        successes: 0,
        expiresAt: Date.UTC(2026, 9, 21) + COUNTS_KEEP_DAYS * DAY_MS,
      },
    ]);
  });

  it("lists every flag for the console with its rules, rollouts, overdue marker and counts", async () => {
    const { flags, tick } = setup({
      registry: [flag({}), flag({ name: "old_flag", removeBy: "2026-10-19" })],
    });
    await flags.setRollout({ name: "new_lobby", rollout: 25 });
    tick(1000);

    const view = await flags.overview();

    expect(view.source).toBe("database");
    expect(view.flags).toEqual([
      {
        name: "new_lobby",
        description: "The new lobby.",
        ticket: "CC-400",
        audience: "everyone",
        removeBy: "2026-12-31",
        overdue: false,
        client: true,
        success: "A room is made from the new lobby.",
        codeRollout: "off",
        rollout: 25,
        override: { rollout: 25, updatedAt: T0 },
        counts: { on: { exposures: 0, successes: 0 }, off: { exposures: 0, successes: 0 } },
      },
      expect.objectContaining({ name: "old_flag", overdue: true, rollout: "off", override: undefined }),
    ]);
  });

  it("says the console shows the code's rollouts while the database cannot be read", async () => {
    const { flags, state } = setup();
    state.down = true;
    await flags.refresh();

    const view = await flags.overview();

    expect(view.source).toBe("code");
    expect(view.flags[0].counts.off.exposures).toBe(0);
  });
});

describe("flag component: refresh timer (CC-312)", () => {
  it("refreshes and writes counts on a timer until stopped, then writes what is left", async () => {
    const { flags, dao } = setup();
    await dao.setOverride({ name: "new_lobby", rollout: "on", updatedAt: new Date(T0) });

    const timer = flags.start({ intervalMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await flags.isOn("new_lobby", GUEST)).toBe(true);
    await timer.stop();

    expect(await dao.countsSince("2026-10-01")).toEqual([
      { flag: "new_lobby", side: "on", exposures: 1, successes: 0 },
    ]);
  });
});
