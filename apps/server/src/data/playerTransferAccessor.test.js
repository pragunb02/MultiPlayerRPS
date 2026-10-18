import { describe, expect, it } from "vitest";
import { createInMemoryPlayerTransferDao } from "../testing/inMemoryPlayerTransferDao.js";
import { createPlayerTransferAccessor } from "./playerTransferAccessor.js";

const T0 = Date.UTC(2026, 9, 16, 12);
const ACCOUNT = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" });
const MOVED = Object.freeze({ xp: 30, matchesPlayed: 1, matches: 1 });
const setup = () => createPlayerTransferAccessor({ playerTransferDao: createInMemoryPlayerTransferDao() });

describe("playerTransferAccessor", () => {
  it("starts a transfer once; starting again returns the existing one", async () => {
    const transfers = setup();

    const first = await transfers.start({ from: "guest_a", to: ACCOUNT, at: T0 });
    const again = await transfers.start({ from: "guest_a", to: ACCOUNT, at: T0 + 1 });

    expect(first).toEqual({
      created: true,
      transfer: { from: "guest_a", to: ACCOUNT, status: "pending", createdAt: T0 },
    });
    expect(again).toEqual({ created: false, transfer: first.transfer });
    expect(Object.isFrozen(first.transfer.to)).toBe(true);
  });

  it("records what moved when a transfer is done", async () => {
    const transfers = setup();
    await transfers.start({ from: "guest_a", to: ACCOUNT, at: T0 });

    await transfers.markDone({ from: "guest_a", at: T0 + 5, carriedOver: MOVED });

    expect((await transfers.start({ from: "guest_a", to: ACCOUNT, at: T0 + 9 })).transfer).toEqual({
      from: "guest_a",
      to: ACCOUNT,
      status: "done",
      createdAt: T0,
      completedAt: T0 + 5,
      carriedOver: MOVED,
    });
  });

  it("lists pending transfers older than a time, and the transfers of given players", async () => {
    const transfers = setup();
    await transfers.start({ from: "guest_a", to: ACCOUNT, at: T0 });
    await transfers.start({ from: "guest_b", to: ACCOUNT, at: T0 + 60_000 });

    const pending = await transfers.listPending({ createdBefore: T0 + 30_000, limit: 10 });
    const ofPlayers = await transfers.listFrom(["guest_b", "guest_x"]);

    expect(pending.map((t) => t.from)).toEqual(["guest_a"]);
    expect(ofPlayers.map((t) => t.from)).toEqual(["guest_b"]);
  });

  it("passes unexpected storage failures through", async () => {
    const failure = new Error("disk on fire");
    const transfers = createPlayerTransferAccessor({
      playerTransferDao: {
        insertPending: async () => {
          throw failure;
        },
      },
    });

    await expect(transfers.start({ from: "guest_a", to: ACCOUNT, at: T0 })).rejects.toBe(failure);
  });

  it("fails fast without a DAO", () => {
    expect(() => createPlayerTransferAccessor({})).toThrow(TypeError);
  });

  it("lists and removes the transfers into one account (CC-035)", async () => {
    const transfers = setup();
    await transfers.start({ from: "guest_a", to: ACCOUNT, at: T0 });

    expect(await transfers.listTo(ACCOUNT.id)).toEqual([
      { from: "guest_a", to: ACCOUNT, status: "pending", createdAt: T0 },
    ]);
    expect(await transfers.removeTo(ACCOUNT.id)).toBe(1);
    expect(await transfers.listTo(ACCOUNT.id)).toEqual([]);
  });
});
