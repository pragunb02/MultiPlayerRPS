import { describe, expect, it } from "vitest";
import { createInMemoryBlockDao } from "../testing/inMemoryBlockDao.js";
import { createBlockAccessor } from "./blockAccessor.js";

const T0 = Date.UTC(2026, 9, 19, 12);
const block = (blockId, blockedId, at = T0) => ({
  blockId,
  blockerId: "guest_a",
  blockedId,
  blockedName: "Bob",
  at,
});

describe("blockAccessor (CC-044)", () => {
  it("stores a block and answers it as a frozen model with times in milliseconds", async () => {
    const blocks = createBlockAccessor({ blockDao: createInMemoryBlockDao() });

    const { created, block: stored } = await blocks.add(block("b1", "guest_b"));

    expect(created).toBe(true);
    expect(stored).toEqual({
      blockId: "b1",
      blockerId: "guest_a",
      blockedId: "guest_b",
      blockedName: "Bob",
      createdAt: T0,
    });
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(await blocks.listBy("guest_a"))).toBe(true);
  });

  it("answers the block already there when the pair is blocked again", async () => {
    const blocks = createBlockAccessor({ blockDao: createInMemoryBlockDao() });
    await blocks.add(block("b1", "guest_b"));

    const again = await blocks.add(block("b2", "guest_b", T0 + 1));

    expect(again).toEqual({
      created: false,
      block: expect.objectContaining({ blockId: "b1", createdAt: T0 }),
    });
  });

  it("passes on a storage failure that is not a repeated pair", async () => {
    const failing = new Error("database down");
    const blocks = createBlockAccessor({
      blockDao: {
        ...createInMemoryBlockDao(),
        insert: async () => {
          throw failing;
        },
      },
    });

    await expect(blocks.add(block("b1", "guest_b"))).rejects.toBe(failing);
  });

  it("says whether removing a block removed anything", async () => {
    const blocks = createBlockAccessor({ blockDao: createInMemoryBlockDao() });
    await blocks.add(block("b1", "guest_b"));

    expect(await blocks.remove({ blockerId: "guest_b", blockId: "b1" })).toBe(false);
    expect(await blocks.remove({ blockerId: "guest_a", blockId: "b1" })).toBe(true);
  });

  it("refuses to be built without its store", () => {
    expect(() => createBlockAccessor({})).toThrow(/blockDao/);
  });
});
