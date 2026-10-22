import { describe, expect, it } from "vitest";

import { realtimeConnects } from "./realtime.js";

describe("realtimeConnects", () => {
  it("counts each time the server accepted the browser's realtime connection", () => {
    const frames = [
      '0{"sid":"a","upgrades":[]}',
      '40{"sid":"b"}',
      '42["friends:updated",{}]',
      "2",
      '40{"sid":"c"}',
    ];
    expect(realtimeConnects(frames)).toBe(2);
  });

  it("does not count a refused connection, a push or the transport's own open", () => {
    const frames = ['0{"sid":"a"}', '44{"message":"unauthorized"}', '42["friend:requested",{}]', "3"];
    expect(realtimeConnects(frames)).toBe(0);
  });
});
