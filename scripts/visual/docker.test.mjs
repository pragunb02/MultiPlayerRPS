import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { containerScript, dockerArgs, parseArgs, VISUAL_IMAGE, VISUAL_PLATFORM } from "./docker.mjs";

const read = (/** @type {string} */ path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

describe("the visual baselines' container", () => {
  it("is the image of the installed Playwright version, so its browser is the one the tests drive", () => {
    const require = createRequire(new URL("../../e2e/package.json", import.meta.url));
    const { version } = require("@playwright/test/package.json");

    expect(VISUAL_IMAGE).toBe(`mcr.microsoft.com/playwright:v${version}-noble`);
  });

  it.each([".github/workflows/ci.yml", ".github/workflows/visual-update.yml"])(
    "is the image %s runs the baselines in",
    async (workflow) => {
      const images = [...(await read(workflow)).matchAll(/image: (\S+)/g)].map((match) => match[1]);

      expect(images.length).toBeGreaterThan(0);
      expect(new Set(images)).toEqual(new Set([VISUAL_IMAGE]));
    },
  );
});

describe("dockerArgs", () => {
  const args = dockerArgs({ repo: "/home/riya/classicade", update: false, uid: 501, gid: 20 });

  it("runs the pinned image as x86, as CI's runners are, with the flags Chromium needs", () => {
    expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
    expect(args).toEqual(expect.arrayContaining(["--init", "--ipc=host", VISUAL_IMAGE]));
    expect(args[args.indexOf("--platform") + 1]).toBe(VISUAL_PLATFORM);
    expect(VISUAL_PLATFORM).toBe("linux/amd64");
  });

  it("mounts the repository and gives the copied files back to the person running it", () => {
    expect(args).toEqual(
      expect.arrayContaining(["/home/riya/classicade:/repo", "HOST_UID=501", "HOST_GID=20"]),
    );
  });

  it("ends with the script the container runs", () => {
    expect(args.slice(-3)).toEqual(["bash", "-c", containerScript({ update: false })]);
  });
});

describe("containerScript", () => {
  it("compares, and copies back only the report and the results", () => {
    const script = containerScript({ update: false });

    expect(script).toContain("npx playwright test -c playwright.visual.config.js\n");
    expect(script).not.toContain("--update-snapshots");
    expect(script).not.toContain("/repo/e2e/visual-baselines\n");
    expect(script).toContain("cp -R visual-results visual-report /repo/e2e/");
  });

  it("when updating, writes only the changed baselines and copies them back", () => {
    const script = containerScript({ update: true });

    expect(script).toContain("npx playwright test -c playwright.visual.config.js --update-snapshots=changed");
    expect(script).toContain("cp -R visual-baselines /repo/e2e/");
  });

  it("installs its own packages, never the host's, and ends with the tests' exit code", () => {
    const script = containerScript({ update: false });

    expect(script).toContain("--exclude='*/node_modules' --exclude=./node_modules");
    expect(script).toContain("npm ci");
    expect(script.split("\n").at(-1)).toBe('exit "$status"');
  });
});

describe("parseArgs", () => {
  it("compares by default and updates with --update", () => {
    expect(parseArgs([])).toEqual({ update: false });
    expect(parseArgs(["--update"])).toEqual({ update: true });
  });

  it("refuses anything else", () => {
    expect(() => parseArgs(["--updat"])).toThrow("unknown argument --updat");
  });
});
