import { describe, expect, it } from "vitest";
import { startTestServer } from "./testApp.js";

describe("startTestServer (CC-287)", () => {
  it("listens on loopback only", async () => {
    const server = await startTestServer();

    try {
      expect(server.httpServer.address()).toEqual(expect.objectContaining({ address: "127.0.0.1", family: "IPv4" }));
      expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await server.close();
    }
  });
});
