import { describe, expect, it } from "vitest";

import { SHARDS, specFilesFor } from "./shards.js";

// That every spec file is in exactly one part, and that CI runs every part, is checked against the files on disk
// and the workflow in scripts/workflows.test.mjs.
describe("specFilesFor", () => {
  it("is every spec file when no part is asked for", () => {
    expect(specFilesFor(undefined)).toBe("*.spec.js");
  });

  it("is the files of the part asked for, counting from 1", () => {
    expect(specFilesFor("1")).toBe(SHARDS[0]);
    expect(specFilesFor(String(SHARDS.length))).toBe(SHARDS.at(-1));
  });

  it("refuses a part that does not exist, so a typo cannot run nothing", () => {
    for (const shard of ["0", String(SHARDS.length + 1), "1.5", "one", ""]) {
      expect(() => specFilesFor(shard)).toThrow(
        `E2E_SHARD must be a whole number from 1 to ${SHARDS.length}`,
      );
    }
  });
});
