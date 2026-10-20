import { describe, expect, it } from "vitest";
import {
  assertClientFlag,
  assertFlagRegistry,
  FLAG_AUDIENCES,
  FLAG_ROLLOUT,
  FLAGS,
  flagNamed,
  isFlagName,
  isRollout,
  overdueFlags,
} from "./flags.js";

// The registry of feature flags (CC-312, ADR-073).
const flag = (fields = {}) => ({
  name: "new_lobby",
  description: "The new lobby layout.",
  ticket: "CC-400",
  default: false,
  removeBy: "2026-12-31",
  rollout: FLAG_ROLLOUT.OFF,
  audience: FLAG_AUDIENCES.EVERYONE,
  client: true,
  success: "A room is made from the new lobby.",
  ...fields,
});

/** Today as the India day the tests run on, so the removal check bites on the real calendar. */
const today = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe("the flag registry (CC-312)", () => {
  it("every registered flag is well formed", () => {
    expect(() => assertFlagRegistry(FLAGS)).not.toThrow();
    expect(FLAGS.length).toBeGreaterThan(0);
    FLAGS.forEach((each) => {
      expect(each.default, each.name).toBe(false);
      expect(Object.isFrozen(each), each.name).toBe(true);
    });
  });

  it("no flag is past its removal date: remove the flag or move its removeBy day in a reviewed PR", () => {
    expect(overdueFlags(FLAGS, today()).map(({ name }) => name)).toEqual([]);
  });

  it("finds the flags whose removal day has passed, not those due today", () => {
    const flags = [
      flag({ name: "old_one", removeBy: "2026-10-19" }),
      flag({ name: "due_today", removeBy: "2026-10-20" }),
    ];

    expect(overdueFlags(flags, "2026-10-20").map(({ name }) => name)).toEqual(["old_one"]);
  });

  it.each([
    ["a name that is not snake case", { name: "NewLobby" }, /name/],
    ["no description", { description: "" }, /description/],
    ["no ticket", { ticket: "issue 4" }, /ticket/],
    ["a default that is on", { default: true }, /default/],
    ["a removal day that is not a day", { removeBy: "2026-02-30" }, /removeBy/],
    ["a rollout over 100", { rollout: 101 }, /rollout/],
    ["a rollout with a fraction", { rollout: 2.5 }, /rollout/],
    ["an unknown audience", { audience: "friends" }, /audience/],
    ["no client marker", { client: "yes" }, /client/],
    ["no success event", { success: "" }, /success/],
  ])("refuses a flag with %s", (_, fields, message) => {
    expect(() => assertFlagRegistry([flag(fields)])).toThrow(message);
  });

  it("refuses a flag with no name or ticket at all", () => {
    expect(() => assertFlagRegistry([flag({ name: undefined, ticket: undefined })])).toThrow(
      /bad name, ticket/,
    );
  });

  it("refuses two flags with the same name", () => {
    expect(() => assertFlagRegistry([flag(), flag()])).toThrow(/twice: new_lobby/);
  });

  it("tells a registered name from any other", () => {
    expect(isFlagName(FLAGS[0].name)).toBe(true);
    expect(isFlagName("no_such_flag")).toBe(false);
    expect(isFlagName(42)).toBe(false);
  });

  it("finds a flag by name and throws on an unknown one", () => {
    expect(flagNamed(FLAGS[0].name)).toBe(FLAGS[0]);
    expect(() => flagNamed("no_such_flag")).toThrow(/Unknown feature flag "no_such_flag"/);
  });

  it("lets the web app read only a flag marked client", () => {
    expect(assertClientFlag(flag())).toEqual(flag());
    expect(() => assertClientFlag(flag({ client: false }))).toThrow(/"new_lobby" is not marked client/);
  });

  it.each([
    ["off", true],
    ["on", true],
    [0, true],
    [100, true],
    [37, true],
    [-1, false],
    [101, false],
    [12.5, false],
    ["50", false],
    [undefined, false],
  ])("treats %j as a rollout: %s", (value, valid) => {
    expect(isRollout(value)).toBe(valid);
  });
});
