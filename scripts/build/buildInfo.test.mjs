import { describe, expect, it } from "vitest";
import { buildInfoFor } from "./buildInfo.mjs";

const SHA = "a40ce5b9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f";

describe("buildInfoFor: what the build writes for the server to read at boot (CC-303)", () => {
  it("names the commit Render builds and its calendar version, from the commit's own date", () => {
    const asked = [];
    const info = buildInfoFor({
      env: { RENDER_GIT_COMMIT: SHA },
      commitDateOf: (commit) => {
        asked.push(commit);
        return "2026-10-20T18:30:00+00:00\n";
      },
    });

    expect(info).toEqual({ commit: SHA, version: "2026.10.20+a40ce5b" });
    expect(asked).toEqual([SHA]);
  });

  it("asks git nothing and knows nothing without RENDER_GIT_COMMIT, as on a laptop, in CI or in Docker", () => {
    const info = buildInfoFor({
      env: {},
      commitDateOf: () => {
        throw new Error("git must not be asked");
      },
    });

    expect(info).toEqual({ commit: "unknown", version: "unknown" });
  });

  it("never passes a RENDER_GIT_COMMIT that is not a commit to git", () => {
    const info = buildInfoFor({
      env: { RENDER_GIT_COMMIT: "--output=/etc/passwd" },
      commitDateOf: () => {
        throw new Error("git must not be asked");
      },
    });

    expect(info).toEqual({ commit: "unknown", version: "unknown" });
  });

  it("keeps the commit and says the version is unknown when git cannot give the date", () => {
    const info = buildInfoFor({
      env: { RENDER_GIT_COMMIT: SHA },
      commitDateOf: () => {
        throw new Error("not a git repository");
      },
    });

    expect(info).toEqual({ commit: SHA, version: "unknown" });
  });
});
