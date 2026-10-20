import { describe, expect, it } from "vitest";
import { parseBuild } from "./build.js";

const SHA = "a40ce5b9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f";
const fileFor = (fields) => JSON.stringify({ commit: SHA, version: "2026.10.20+a40ce5b", ...fields });

describe("parseBuild: the deployed commit and version, read once at boot (CC-303)", () => {
  it("takes the commit Render runs and the version the build wrote for it", () => {
    expect(parseBuild({ env: { RENDER_GIT_COMMIT: SHA }, buildInfoText: fileFor({}) })).toEqual({
      commit: SHA,
      version: "2026.10.20+a40ce5b",
    });
  });

  it("is unknown on a laptop or in CI, where Render sets nothing and the build wrote nothing", () => {
    expect(parseBuild({ env: {}, buildInfoText: "" })).toEqual({ commit: "unknown", version: "unknown" });
  });

  it.each([
    ["an email", "someone@example.com"],
    ["a sha with a second line", `${SHA}\nSECRET=hunter2`],
    ["capitals", SHA.toUpperCase()],
  ])("never shows a RENDER_GIT_COMMIT that is %s", (_, value) => {
    const build = parseBuild({
      env: { RENDER_GIT_COMMIT: value },
      buildInfoText: fileFor({ commit: value }),
    });

    expect(build).toEqual({ commit: "unknown", version: "unknown" });
  });

  it("keeps the commit and says the version is unknown when the build wrote no file", () => {
    expect(parseBuild({ env: { RENDER_GIT_COMMIT: SHA }, buildInfoText: "" })).toEqual({
      commit: SHA,
      version: "unknown",
    });
  });

  it.each([
    ["a file that is not JSON", "{not json"],
    ["a file that is not an object", "[]"],
    ["a file written for another commit", fileFor({ commit: "b".repeat(40), version: "2026.10.20+bbbbbbb" })],
    ["a version of another shape", fileFor({ version: "1.0.0" })],
    ["a version naming another commit", fileFor({ version: "2026.10.20+bbbbbbb" })],
    ["a version with markup", fileFor({ version: "<b>2026</b>" })],
  ])("says the version is unknown, without stopping the boot, for %s", (_, buildInfoText) => {
    expect(parseBuild({ env: { RENDER_GIT_COMMIT: SHA }, buildInfoText })).toEqual({
      commit: SHA,
      version: "unknown",
    });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(parseBuild({ env: {}, buildInfoText: "" }))).toBe(true);
  });
});
