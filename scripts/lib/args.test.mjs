import { describe, expect, it } from "vitest";

import { parseNamedArgs } from "./args.mjs";
import { OpsError } from "./errors.mjs";

describe("parseNamedArgs", () => {
  it("returns every named value", () => {
    const values = parseNamedArgs({ argv: ["--uri", "mongodb://h", "--db", "app"], names: ["uri", "db"] });

    expect(values).toEqual({ uri: "mongodb://h", db: "app" });
    expect(Object.isFrozen(values)).toBe(true);
  });

  it("accepts no arguments when none are expected", () => {
    expect(parseNamedArgs({ argv: [], names: [] })).toEqual({});
  });

  it.each([
    ["a value without a name", ["--uri"]],
    ["an unknown option", ["--url", "x"]],
    ["a value where a name belongs", ["uri", "x"]],
    ["the same option twice", ["--uri", "a", "--uri", "b"]],
    ["a missing option", ["--uri", "a"]],
    ["an empty value", ["--uri", "", "--db", "app"]],
  ])("rejects %s", (_, argv) => {
    expect(() => parseNamedArgs({ argv, names: ["uri", "db"] })).toThrow(OpsError);
  });
});
