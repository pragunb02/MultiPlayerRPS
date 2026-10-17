import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { annotation, appendSummary, maskCommand, runnerFile, writeOutputs } from "./actions.mjs";
import { OpsError } from "./errors.mjs";

describe("workflow commands", () => {
  it("formats an annotation and escapes characters the runner treats as syntax", () => {
    const line = annotation({ level: "warning", title: "a: b, c", message: "100% sure\nnext line" });

    expect(line).toBe("::warning title=a%3A b%2C c::100%25 sure%0Anext line\n");
  });

  it("formats a mask command so a multi line secret stays one command", () => {
    expect(maskCommand("p@ss\r\nword")).toBe("::add-mask::p@ss%0D%0Aword\n");
  });
});

describe("runner files", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-actions-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("returns the path the runner gave", () => {
    expect(runnerFile({ GITHUB_OUTPUT: "/x/out" }, "GITHUB_OUTPUT")).toBe("/x/out");
  });

  it("fails when the runner file is not set, instead of dropping the result", () => {
    expect(() => runnerFile({}, "GITHUB_STEP_SUMMARY")).toThrow(OpsError);
  });

  it("appends outputs as name=value lines", async () => {
    const file = join(dir, "out");

    await writeOutputs({ file, outputs: { ready: "true", key: "mongo/a" } });
    await writeOutputs({ file, outputs: { state: "up" } });

    expect(await readFile(file, "utf8")).toBe("ready=true\nkey=mongo/a\nstate=up\n");
  });

  it("rejects an output value with a line break", async () => {
    await expect(writeOutputs({ file: join(dir, "out"), outputs: { key: "a\nb" } })).rejects.toThrow(
      OpsError,
    );
  });

  it("appends Markdown to the summary", async () => {
    const file = join(dir, "summary");

    await appendSummary({ file, markdown: "### Up" });

    expect(await readFile(file, "utf8")).toBe("### Up\n");
  });
});
