// Watches a page for the answer to a press (CC-170), the technique from the UX audit (docs/ux/MATCH_EXPERIENCE.md).
// A script in the page records, with the page's own clock, when the press went down and when anything answered it:
// a change to the page (a MutationObserver over the whole document), a message to the server (a socket send or a
// fetch), a sound (a Web Audio oscillator other than the click sound every button makes), or a new address.
// Elements marked `data-cc-ticker` change every second by themselves (clocks, countdowns), so they never count.

/** The click sound every button makes (lib/sound/sounds.js). It says "pressed", not "answered", so it never counts. */
const CLICK_SOUND_HZ = 1200;

/** Runs in the page before any of its own scripts. */
function probeScript(clickHz) {
  const state = { press: 0, changes: [], sends: [], sounds: [] };
  const ticking = (node) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(element?.closest("[data-cc-ticker]"));
  };
  // A focus move changes which square is in the Tab order. That is bookkeeping, not an answer.
  const counts = (record) => !(record.type === "attributes" && record.attributeName === "tabindex");
  new MutationObserver((records) => {
    if (records.some((record) => counts(record) && !ticking(record.target))) {
      state.changes.push(performance.now());
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  document.addEventListener("pointerdown", () => (state.press = performance.now()), true);

  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (...args) {
    state.sends.push(performance.now());
    return send.apply(this, args);
  };
  const fetch = window.fetch;
  window.fetch = (...args) => {
    state.sends.push(performance.now());
    return fetch(...args);
  };
  const Audio = window.BaseAudioContext ?? window.AudioContext;
  if (Audio !== undefined) {
    const create = Audio.prototype.createOscillator;
    Audio.prototype.createOscillator = function () {
      const oscillator = create.call(this);
      const sound = { at: performance.now(), hz: 0 };
      state.sounds.push(sound);
      const setValue = oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
      oscillator.frequency.setValueAtTime = (value, time) => {
        if (sound.hz === 0) sound.hz = value;
        return setValue(value, time);
      };
      return oscillator;
    };
  }

  window.__ccProbe = {
    /** Forgets everything before now, and says where the page is. */
    arm() {
      state.press = 0;
      state.changes = [];
      state.sends = [];
      state.sounds = [];
      return { href: location.href, at: performance.now() };
    },
    /** How long after the press each kind of answer came, in ms (Infinity for none). */
    read() {
      const from = state.press;
      const first = (times) => Math.min(...times.filter((at) => at >= from).map((at) => at - from), Infinity);
      return {
        pressed: from > 0,
        change: first(state.changes),
        send: first(state.sends),
        sound: first(state.sounds.filter((sound) => sound.hz !== clickHz).map((sound) => sound.at)),
        href: location.href,
      };
    },
    /** Whether the page changed at all since `arm`, for the other player's screen. */
    changedSince(at) {
      return state.changes.some((time) => time >= at) || state.sounds.some((sound) => sound.at >= at);
    },
  };
}

/** Installs the probe in every page this player opens from now on. */
export async function installProbe(player) {
  await player.context.addInitScript(probeScript, CLICK_SOUND_HZ);
}

/** Starts watching for the answer to the next press. */
export const arm = (page) => page.evaluate(() => window.__ccProbe.arm());

/**
 * What answered the press since `arm`: the fastest answer in ms, and which kind it was. A press that left the page
 * (a link to another address) answers by leaving.
 */
export async function answerTo(page, armed) {
  const seen = await page.evaluate(() => window.__ccProbe?.read()).catch(() => undefined);
  if (seen === undefined) {
    return { ms: 0, kind: "navigation", pressed: true };
  }
  if (seen.href !== armed.href) {
    return { ms: 0, kind: "navigation", pressed: seen.pressed };
  }
  const kinds = [
    ["change", seen.change],
    ["message", seen.send],
    ["sound", seen.sound],
  ].sort((a, b) => a[1] - b[1]);
  return { ms: kinds[0][1], kind: kinds[0][0], pressed: seen.pressed };
}

/** Whether `page` showed anything new since `armed`, polled for up to `withinMs`. */
export async function otherSaw(page, armed, withinMs) {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (await page.evaluate((at) => window.__ccProbe.changedSince(at), armed.at)) return true;
    await page.waitForTimeout(50);
  }
  return false;
}
