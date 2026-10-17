import { describe, expect, it, vi } from "vitest";
import { createSessionBroadcast, SESSION_CHANNEL } from "./sessionBroadcast.js";

/** Stands in for the browser's BroadcastChannel: every channel of one name hears the others, never itself. */
function fakeChannels() {
  const open = new Set();
  class FakeChannel extends EventTarget {
    constructor(name) {
      super();
      this.name = name;
      this.posted = [];
      open.add(this);
    }
    postMessage(data) {
      this.posted.push(data);
      for (const other of open) {
        if (other !== this && other.name === this.name) {
          other.dispatchEvent(new MessageEvent("message", { data }));
        }
      }
    }
  }
  return { Channel: FakeChannel, open };
}

describe("session broadcast between tabs (CC-115)", () => {
  it("tells the other tabs that the session changed", () => {
    const { Channel } = fakeChannels();
    const thisTab = createSessionBroadcast({ Channel });
    const otherTab = createSessionBroadcast({ Channel });
    const heard = vi.fn();
    otherTab.onChange(heard);

    thisTab.announce();

    expect(heard).toHaveBeenCalledOnce();
  });

  it("does not tell the tab that announced", () => {
    const { Channel } = fakeChannels();
    const thisTab = createSessionBroadcast({ Channel });
    const heard = vi.fn();
    thisTab.onChange(heard);

    thisTab.announce();

    expect(heard).not.toHaveBeenCalled();
  });

  it("sends one word on its own channel, and nothing about who the player is", () => {
    const { Channel, open } = fakeChannels();
    createSessionBroadcast({ Channel }).announce();

    const [channel] = open;

    expect(channel.name).toBe(SESSION_CHANNEL);
    expect(channel.posted).toEqual(["changed"]);
  });

  it("ignores any other message on the channel", () => {
    const { Channel } = fakeChannels();
    const otherTab = createSessionBroadcast({ Channel });
    const heard = vi.fn();
    otherTab.onChange(heard);

    new Channel(SESSION_CHANNEL).postMessage({ identity: { id: "user_1" } });

    expect(heard).not.toHaveBeenCalled();
  });

  it("stops listening after unsubscribing", () => {
    const { Channel } = fakeChannels();
    const thisTab = createSessionBroadcast({ Channel });
    const otherTab = createSessionBroadcast({ Channel });
    const heard = vi.fn();
    const off = otherTab.onChange(heard);

    off();
    thisTab.announce();

    expect(heard).not.toHaveBeenCalled();
  });

  it("does nothing in a browser without BroadcastChannel", () => {
    const broadcast = createSessionBroadcast({ Channel: undefined });
    const heard = vi.fn();

    const off = broadcast.onChange(heard);
    broadcast.announce();
    off();
    broadcast.close();

    expect(heard).not.toHaveBeenCalled();
  });

  it("works between two real channels of this runtime", async () => {
    const thisTab = createSessionBroadcast({ Channel: globalThis.BroadcastChannel });
    const otherTab = createSessionBroadcast({ Channel: globalThis.BroadcastChannel });
    const heard = new Promise((resolve) => otherTab.onChange(resolve));

    thisTab.announce();

    await expect(heard).resolves.toBeUndefined();
    thisTab.close();
    otherTab.close();
  });
});
