import { describe, expect, it } from "vitest";
import { createNetworkKey } from "./networkKey.js";

describe("createNetworkKey (CC-107)", () => {
  it("gives the same short name for the same address, and never the address itself", () => {
    const networkOf = createNetworkKey({ secret: "a secret of this server" });

    expect(networkOf("ip:203.0.113.7")).toBe(networkOf("ip:203.0.113.7"));
    expect(networkOf("ip:203.0.113.7")).toMatch(/^[0-9a-f]{16}$/);
    expect(networkOf("ip:203.0.113.7")).not.toBe(networkOf("ip:203.0.113.8"));
  });

  it("depends on the secret, so the names mean nothing outside this server", () => {
    const one = createNetworkKey({ secret: "one" });
    const two = createNetworkKey({ secret: "two" });

    expect(one("ip:203.0.113.7")).not.toBe(two("ip:203.0.113.7"));
  });

  it.each([[""], [undefined]])("needs a secret (%o)", (secret) => {
    expect(() => createNetworkKey({ secret })).toThrow(TypeError);
  });
});
