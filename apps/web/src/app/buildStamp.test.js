import { describe, expect, it } from "vitest";
import { APP_BUILD, buildStamp } from "./buildStamp.js";

describe("buildStamp: the web build's version and commit (CC-290)", () => {
  it("is the version and the short commit", () => {
    expect(buildStamp({ version: "0.1.0", commit: "3F9C2AB9D0E1F2A3B4C5D6E7F8091A2B3C4D5E6F" })).toBe(
      "0.1.0+3f9c2ab",
    );
  });

  it.each([undefined, "", "not a commit!"])("says local for a build without a commit (%s)", (commit) => {
    expect(buildStamp({ version: "0.1.0", commit })).toBe("0.1.0+local");
  });

  it("names this build dev when no build stamped it, as in tests and the dev server", () => {
    expect(APP_BUILD).toBe("dev");
  });
});
