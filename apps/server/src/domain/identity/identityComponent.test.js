import { describe, expect, it } from "vitest";
import { createIdentityComponent } from "./identityComponent.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("identityComponent.createGuest", () => {
  it("builds a guest identity from the injected generators", () => {
    const component = createIdentityComponent({ generateId: () => UUID, generateGuestSuffix: () => "7K2Q" });

    expect(component.createGuest()).toEqual({
      kind: "guest",
      id: `guest_${UUID}`,
      displayName: "Guest-7K2Q",
    });
  });

  it("produces unique, readable guests with the default generators", () => {
    const component = createIdentityComponent();

    const guests = Array.from({ length: 50 }, () => component.createGuest());

    expect(new Set(guests.map((g) => g.id)).size).toBe(50);
    for (const guest of guests) {
      expect(guest.displayName).toMatch(/^Guest-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it("fails fast when a generator is not a function", () => {
    expect(() => createIdentityComponent({ generateId: "nope" })).toThrow(TypeError);
  });
});
