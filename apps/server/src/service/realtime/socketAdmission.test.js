import { describe, expect, it } from "vitest";
import { roomLimits } from "../../domain/rooms/roomLimits.js";
import { createSocketAdmission, SOCKET_REFUSALS } from "./socketAdmission.js";

function setup(limits = {}) {
  let time = 0;
  const admission = createSocketAdmission({
    limits: roomLimits({ eventBurstPerPlayer: 2, eventsPerSecondPerPlayer: 1, ...limits }),
    now: () => time,
  });
  return { admission, advance: (ms) => (time += ms) };
}

const tab = (overrides = {}) => ({ sessionId: "s1", address: "ip:1.1.1.1", playerId: "p1", ...overrides });

describe("socket admission (CC-107)", () => {
  it("admits connections of one session up to its cap, and refuses the next with what to do", () => {
    const { admission } = setup({ socketsPerSession: 2 });

    const first = admission.admit(tab());
    const second = admission.admit(tab());
    const third = admission.admit(tab());

    expect([first.admitted, second.admitted]).toEqual([true, true]);
    expect(third).toEqual({ admitted: false, message: SOCKET_REFUSALS.SESSION });
    expect(admission.admit(tab({ sessionId: "s2" })).admitted).toBe(true);
  });

  it("admits connections of one address up to its cap, whatever session they use", () => {
    const { admission } = setup({ socketsPerAddress: 2 });
    admission.admit(tab({ sessionId: "a" }));
    admission.admit(tab({ sessionId: "b" }));

    expect(admission.admit(tab({ sessionId: "c" }))).toEqual({
      admitted: false,
      message: SOCKET_REFUSALS.ADDRESS,
    });
    expect(admission.admit(tab({ sessionId: "c", address: "ip:2.2.2.2" })).admitted).toBe(true);
  });

  it("gives the place back when a connection closes, once even if released twice", () => {
    const { admission } = setup({ socketsPerSession: 1 });
    const first = admission.admit(tab());

    first.release();
    first.release();

    expect(admission.admit(tab()).admitted).toBe(true);
    expect(admission.admit(tab()).admitted).toBe(false);
  });

  it("shares one event budget between every tab of a player", () => {
    const { admission } = setup();
    admission.admit(tab({ sessionId: "laptop" }));
    admission.admit(tab({ sessionId: "phone" }));

    expect([admission.allowEvent("p1"), admission.allowEvent("p1"), admission.allowEvent("p1")]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("keeps an emptied budget when the player leaves and comes back, until it has refilled", () => {
    const { admission, advance } = setup();
    const first = admission.admit(tab());
    admission.allowEvent("p1");
    admission.allowEvent("p1");
    first.release();

    admission.admit(tab());
    expect(admission.allowEvent("p1")).toBe(false);
    advance(1_000);

    expect(admission.allowEvent("p1")).toBe(true);
  });

  it("forgets the budget of a player who left once it has refilled, so memory does not grow", () => {
    const { admission, advance } = setup();
    const left = admission.admit(tab());
    admission.allowEvent("p1");
    left.release();
    admission.admit(tab({ playerId: "p2", sessionId: "s2" }));
    expect(admission.allowEvent("p1")).toBe(true); // still refilling, so it was kept
    advance(5_000);

    admission.admit(tab({ playerId: "p3", sessionId: "s3" }));

    expect(admission.allowEvent("p1")).toBe(false); // nobody of that id is connected, so nothing is allowed
    expect(admission.counts()).toEqual({ connections: 2, players: 2 });
  });

  it("refuses events of a player who is not connected", () => {
    expect(setup().admission.allowEvent("nobody")).toBe(false);
  });

  it("counts open connections and connected players for the gauge", () => {
    const { admission } = setup();
    admission.admit(tab({ sessionId: "laptop" }));
    admission.admit(tab({ sessionId: "phone" }));
    admission.admit(tab({ playerId: "p2", sessionId: "s2" })).release();

    expect(admission.counts()).toEqual({ connections: 2, players: 1 });
  });
});
