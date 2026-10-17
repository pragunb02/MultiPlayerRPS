import { describe, expect, it, vi } from "vitest";
import { CLICK_SOUND_SELECTOR, createSoundPlayer } from "./soundPlayer.js";
import { RECIPES } from "./sounds.js";

/** A pretend Web Audio context that records every node it makes, as a browser's would play them. */
function fakeAudioContext({ state = "running", resume = async () => undefined } = {}) {
  const oscillators = [];
  const gains = [];
  const context = {
    state,
    currentTime: 2,
    destination: { name: "speakers" },
    resume: vi.fn(async () => {
      await resume();
      context.state = "running";
    }),
    createGain() {
      const node = {
        gain: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(node);
      return node;
    },
    createOscillator() {
      const node = {
        type: "",
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      oscillators.push(node);
      return node;
    },
  };
  return { context, oscillators, gains };
}

/** Saved preferences in memory. */
function memoryPreferences(initial = { muted: false, volume: 0.5 }) {
  const saved = [];
  return { saved, load: () => initial, save: (settings) => saved.push(settings) };
}

const RECIPES_FOR_TEST = Object.freeze({
  tock: [{ at: 0, freq: 500, dur: 0.1, wave: "triangle", gain: 0.5, to: 300 }],
  chime: [
    { at: 0, freq: 800, dur: 0.2, wave: "sine", gain: 0.3 },
    { at: 0.1, freq: 1200, dur: 0.2, wave: "sine", gain: 0.2 },
  ],
  click: [{ at: 0, freq: 1200, dur: 0.02, wave: "triangle", gain: 0.1 }],
});

function setup({ audio = fakeAudioContext(), active = true, preferences = memoryPreferences() } = {}) {
  const createContext = vi.fn(() => audio.context);
  const player = createSoundPlayer({
    createContext,
    hasUserActivation: () => active,
    preferences,
    recipes: RECIPES_FOR_TEST,
  });
  return { player, audio, createContext, preferences };
}

describe("soundPlayer (CC-103)", () => {
  it("stays silent and creates no audio before the player has interacted with the page", () => {
    const { player, createContext } = setup({ active: false });

    player.unlock();

    expect(createContext).not.toHaveBeenCalled();
    expect(player.play("tock")).toBe(false);
  });

  it("starts audio once during a gesture, at the saved volume", () => {
    const { player, audio, createContext } = setup();

    player.unlock();
    player.unlock();

    expect(createContext).toHaveBeenCalledOnce();
    const [master] = audio.gains;
    // 0.5 on the slider is 0.25 loudness (squared), times the master level 0.8.
    expect(master.gain.value).toBeCloseTo(0.2);
    expect(master.connect).toHaveBeenCalledWith(audio.context.destination);
  });

  it("resumes a context the browser suspended, and a refusal is just silence", async () => {
    const audio = fakeAudioContext({
      state: "suspended",
      resume: async () => {
        throw new Error("NotAllowedError");
      },
    });
    const { player } = setup({ audio });

    expect(() => player.unlock()).not.toThrow();
    await Promise.resolve();

    expect(audio.context.resume).toHaveBeenCalledOnce();
    expect(player.play("tock")).toBe(false);
  });

  it("plays a sound when the context is running after a resume", async () => {
    const audio = fakeAudioContext({ state: "suspended" });
    const { player } = setup({ audio });

    player.unlock();
    await vi.waitFor(() => expect(audio.context.state).toBe("running"));

    expect(player.play("tock")).toBe(true);
  });

  it("turns each note into an oscillator that fades in and out and then unplugs itself", () => {
    const { player, audio } = setup();
    player.unlock();

    expect(player.play("tock")).toBe(true);

    const [oscillator] = audio.oscillators;
    const [master, gain] = audio.gains;
    expect(oscillator.type).toBe("triangle");
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(500, 2.01);
    expect(oscillator.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(300, 2.11);
    const [fadeIn, fadeOut] = gain.gain.exponentialRampToValueAtTime.mock.calls;
    expect(fadeIn[0]).toBe(0.5);
    expect(fadeIn[1]).toBeCloseTo(2.015);
    expect(fadeOut).toEqual([0.0001, 2.11]);
    expect(oscillator.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(master);
    expect(oscillator.start).toHaveBeenCalledWith(2.01);
    expect(oscillator.stop.mock.calls[0][0]).toBeCloseTo(2.13);

    oscillator.onended();
    expect(oscillator.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
  });

  it("keeps a steady pitch for notes without a glide", () => {
    const { player, audio } = setup();
    player.unlock();

    player.play("chime");

    expect(audio.oscillators).toHaveLength(2);
    expect(audio.oscillators[0].frequency.exponentialRampToValueAtTime).not.toHaveBeenCalled();
    expect(audio.oscillators[1].start).toHaveBeenCalledWith(2.11);
  });

  it("plays several sounds one after another instead of on top of each other", () => {
    const { player, audio } = setup();
    player.unlock();

    expect(player.play(["tock", "click"])).toBe(true);

    expect(audio.oscillators[0].start).toHaveBeenCalledWith(2.01);
    expect(audio.oscillators[1].start.mock.calls[0][0]).toBeCloseTo(2.13);
  });

  it("plays nothing for an empty list, when muted, or at zero volume", () => {
    const { player, audio } = setup();
    player.unlock();

    expect(player.play([])).toBe(false);
    player.setMuted(true);
    expect(player.play("tock")).toBe(false);
    player.setMuted(false);
    player.setVolume(0);
    expect(player.play("tock")).toBe(false);
    expect(audio.oscillators).toHaveLength(0);
  });

  it("refuses a sound name it does not know, because that is a mistake in the code", () => {
    const { player } = setup();

    expect(() => player.play("boing")).toThrow("Unknown sound: boing");
    expect(() => player.play(["tock", "boing"])).toThrow(/boing/);
  });

  it("saves every change, applies it to what is playing, and tells subscribers", () => {
    const { player, audio, preferences } = setup();
    player.unlock();
    const listener = vi.fn();
    const unsubscribe = player.subscribe(listener);
    const before = player.settings();

    player.setMuted(true);
    expect(audio.gains[0].gain.value).toBe(0);
    player.setVolume(1);
    player.setMuted(false);
    expect(audio.gains[0].gain.value).toBeCloseTo(0.8);

    expect(preferences.saved).toEqual([
      { muted: true, volume: 0.5 },
      { muted: true, volume: 1 },
      { muted: false, volume: 1 },
    ]);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(player.settings()).not.toBe(before);
    expect(Object.isFrozen(player.settings())).toBe(true);

    unsubscribe();
    player.setVolume(0.3);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("returns the same settings object until something changes, so React does not re-render for nothing", () => {
    const { player } = setup();

    expect(player.settings()).toBe(player.settings());
    expect(player.settings()).toEqual({ muted: false, volume: 0.5 });
  });

  it("changes settings before audio has started too", () => {
    const { player } = setup({ active: false });

    player.setMuted(true);

    expect(player.settings().muted).toBe(true);
  });

  it.each([[2], [-0.1], [Number.NaN], ["loud"]])("refuses the volume %s", (volume) => {
    const { player } = setup();

    expect(() => player.setVolume(volume)).toThrow(RangeError);
  });

  it("refuses a mute setting that is not true or false", () => {
    const { player } = setup();

    expect(() => player.setMuted("yes")).toThrow(TypeError);
  });

  it("goes quiet for good in a browser without Web Audio, without an error", () => {
    const audio = fakeAudioContext();
    const createContext = vi.fn(() => {
      throw new ReferenceError("AudioContext is not defined");
    });
    const player = createSoundPlayer({
      createContext,
      hasUserActivation: () => true,
      preferences: memoryPreferences(),
      recipes: RECIPES_FOR_TEST,
    });

    expect(() => player.unlock()).not.toThrow();
    player.unlock();

    expect(createContext).toHaveBeenCalledOnce();
    expect(player.play("tock")).toBe(false);
    expect(audio.oscillators).toHaveLength(0);
  });

  it("swallows an audio node that fails while playing", () => {
    const audio = fakeAudioContext();
    audio.context.createOscillator = () => {
      throw new Error("InvalidStateError");
    };
    const { player } = setup({ audio });
    player.unlock();

    expect(player.play("tock")).toBe(false);
  });

  it("uses the app's catalogue unless told otherwise", () => {
    const audio = fakeAudioContext();
    const player = createSoundPlayer({
      createContext: () => audio.context,
      hasUserActivation: () => true,
      preferences: memoryPreferences(),
    });
    player.unlock();

    expect(player.play("move")).toBe(true);
    expect(audio.oscillators).toHaveLength(RECIPES.move.length);
  });

  describe("listen", () => {
    it("unlocks audio on the first gesture and clicks for marked buttons only", () => {
      const { player, audio } = setup();
      const page = new EventTarget();
      const undo = player.listen(page);
      const marked = document.createElement("button");
      marked.dataset.sound = "click";
      const label = document.createElement("span");
      marked.append(label);
      const plain = document.createElement("button");

      page.dispatchEvent(new Event("pointerdown"));
      expect(audio.gains).toHaveLength(1);

      const click = (target) => {
        const event = new Event("click");
        Object.defineProperty(event, "target", { value: target });
        page.dispatchEvent(event);
      };
      click(label);
      click(plain);
      click({ notAnElement: true });

      expect(audio.oscillators).toHaveLength(RECIPES_FOR_TEST.click.length);
      expect(marked.matches(CLICK_SOUND_SELECTOR)).toBe(true);

      undo();
      click(label);
      expect(audio.oscillators).toHaveLength(RECIPES_FOR_TEST.click.length);
    });

    it("listens to every kind of gesture a browser accepts", () => {
      const { player } = setup();
      const page = { addEventListener: vi.fn(), removeEventListener: vi.fn() };

      player.listen(page)();

      const types = page.addEventListener.mock.calls.map(([type]) => type);
      expect(types).toEqual(["pointerdown", "pointerup", "keydown", "touchend", "click"]);
      expect(page.addEventListener.mock.calls.every(([, , capture]) => capture === true)).toBe(true);
      expect(page.removeEventListener).toHaveBeenCalledTimes(5);
    });
  });
});
