import { afterEach, describe, expect, it, vi } from "vitest";

import { CHROMIUM_MUTES_AUDIO, FIREFOX_MUTES_AUDIO, silenceWebAudio } from "./testAudio.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const launchOptionsOf = (config, project) => ({ ...config.use, ...project.use }).launchOptions ?? {};

// A laptop running the browser tests played the game sounds out loud (CC-344).
describe("the test browsers are silent", () => {
  it("start Chromium muted in every project of both browser test configurations", async () => {
    const { default: suite } = await import("./playwright.config.js");
    const { default: visual } = await import("./playwright.visual.config.js");
    for (const config of [suite, visual]) {
      for (const project of config.projects) {
        expect(launchOptionsOf(config, project).args, project.name).toEqual(
          expect.arrayContaining([...CHROMIUM_MUTES_AUDIO]),
        );
      }
    }
  });

  it("start Firefox at volume 0", async () => {
    vi.stubEnv("E2E_BROWSER", "firefox");
    const { default: suite } = await import("./playwright.config.js");

    for (const project of suite.projects) {
      expect(launchOptionsOf(suite, project).firefoxUserPrefs, project.name).toEqual(FIREFOX_MUTES_AUDIO);
    }
  });

  it("start WebKit with no launch options, as it has no way to mute", async () => {
    vi.stubEnv("E2E_BROWSER", "webkit");
    const { default: suite } = await import("./playwright.config.js");

    for (const project of suite.projects) {
      expect(launchOptionsOf(suite, project), project.name).toEqual({});
    }
  });
});

describe("silenceWebAudio", () => {
  /** An audio context with just what the script uses: the speakers and gain nodes. */
  function fakeAudio() {
    const speakers = { name: "speakers" };
    class FakeContext {
      get destination() {
        return speakers;
      }

      createGain() {
        const node = { gain: { value: 1 }, connect: (to) => (node.to = to) };
        return node;
      }
    }
    return { speakers, FakeContext };
  }

  it("puts a gain of 0 between each audio context and the speakers, the same one every time", () => {
    const { speakers, FakeContext } = fakeAudio();
    vi.stubGlobal("window", { AudioContext: FakeContext });

    silenceWebAudio();
    const context = new FakeContext();
    const other = new FakeContext();

    expect(context.destination.gain.value).toBe(0);
    expect(context.destination.to).toBe(speakers);
    expect(context.destination).toBe(context.destination);
    expect(other.destination).not.toBe(context.destination);
  });

  it("uses BaseAudioContext when the page has it", () => {
    const { FakeContext } = fakeAudio();
    vi.stubGlobal("window", { BaseAudioContext: FakeContext });

    silenceWebAudio();

    expect(new FakeContext().destination.gain.value).toBe(0);
  });

  it("uses Safari's older webkitAudioContext when that is all there is", () => {
    const { FakeContext } = fakeAudio();
    vi.stubGlobal("window", { webkitAudioContext: FakeContext });

    silenceWebAudio();

    expect(new FakeContext().destination.gain.value).toBe(0);
  });

  it("leaves a page without Web Audio alone, or one whose contexts have no speakers to put it in front of", () => {
    class NoSpeakers {}
    vi.stubGlobal("window", {});
    expect(() => silenceWebAudio()).not.toThrow();

    vi.stubGlobal("window", { AudioContext: NoSpeakers });
    silenceWebAudio();

    expect(Object.getOwnPropertyDescriptor(NoSpeakers.prototype, "destination")).toBeUndefined();
  });
});
