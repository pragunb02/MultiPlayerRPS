import { expect, it } from "vitest";

const T0 = Date.UTC(2026, 9, 20, 12);
const at = (seconds) => new Date(T0 + seconds * 1000);

let counter = 0;
/** A feedback record as the accessor writes it, with a fresh id unless one is given. */
export const feedbackRecord = ({
  seconds = 0,
  type = "bug",
  status = "new",
  feedbackId,
  replyEmail,
  message = "The board froze",
} = {}) => ({
  feedbackId: feedbackId ?? `00000000-0000-4000-a000-${String(++counter).padStart(12, "0")}`,
  type,
  message,
  ...(replyEmail !== undefined && { replyEmail }),
  page: "/games/chess/rooms/:code",
  build: "0.1.0+abc1234",
  device: "phone",
  kind: "guest",
  status,
  createdAt: at(seconds),
  updatedAt: at(seconds),
});

/**
 * Behaviour every feedback DAO must have (CC-290): the MongoDB DAO and the in-memory double.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/feedbackDao.js").createFeedbackDao>>} createDao
 */
export function runFeedbackDaoContract(createDao) {
  it("stores an item and answers it as stored", async () => {
    const dao = await createDao();
    const item = feedbackRecord({ replyEmail: "riya@example.com" });

    const stored = await dao.insert(item);

    expect(stored).toEqual(item);
    expect(await dao.list({ where: {}, limit: 10 })).toEqual([item]);
  });

  it("stores an item without a reply email without the field", async () => {
    const dao = await createDao();

    await dao.insert(feedbackRecord());

    const [listed] = await dao.list({ where: {}, limit: 10 });
    expect(listed).not.toHaveProperty("replyEmail");
  });

  it("lists newest first, and the larger id first when two share a moment", async () => {
    const dao = await createDao();
    const old = feedbackRecord({ seconds: 1 });
    const newest = feedbackRecord({ seconds: 3 });
    const tieLow = feedbackRecord({ seconds: 2, feedbackId: "00000000-0000-4000-a000-00000000aaa1" });
    const tieHigh = feedbackRecord({ seconds: 2, feedbackId: "00000000-0000-4000-a000-00000000aaa2" });
    for (const item of [old, tieLow, newest, tieHigh]) await dao.insert(item);

    const listed = await dao.list({ where: {}, limit: 10 });

    expect(listed.map((item) => item.feedbackId)).toEqual([
      newest.feedbackId,
      tieHigh.feedbackId,
      tieLow.feedbackId,
      old.feedbackId,
    ]);
  });

  it("answers at most `limit` items", async () => {
    const dao = await createDao();
    for (const seconds of [1, 2, 3]) await dao.insert(feedbackRecord({ seconds }));

    expect(await dao.list({ where: {}, limit: 2 })).toHaveLength(2);
  });

  it("lists only the items older than a cursor, so pages never repeat or skip one", async () => {
    const dao = await createDao();
    const items = [
      feedbackRecord({ seconds: 1 }),
      feedbackRecord({ seconds: 2, feedbackId: "00000000-0000-4000-a000-00000000bbb1" }),
      feedbackRecord({ seconds: 2, feedbackId: "00000000-0000-4000-a000-00000000bbb2" }),
      feedbackRecord({ seconds: 3 }),
    ];
    for (const item of items) await dao.insert(item);

    const first = await dao.list({ where: {}, limit: 2 });
    const last = first.at(-1);
    const second = await dao.list({
      where: {},
      limit: 2,
      before: { createdAt: last.createdAt, feedbackId: last.feedbackId },
    });

    expect([...first, ...second].map((item) => item.feedbackId)).toEqual([
      items[3].feedbackId,
      items[2].feedbackId,
      items[1].feedbackId,
      items[0].feedbackId,
    ]);
  });

  it("filters by type and by status", async () => {
    const dao = await createDao();
    const idea = feedbackRecord({ type: "idea", seconds: 1 });
    const doneBug = feedbackRecord({ type: "bug", status: "done", seconds: 2 });
    const newBug = feedbackRecord({ type: "bug", seconds: 3 });
    for (const item of [idea, doneBug, newBug]) await dao.insert(item);

    const ids = async (where) => (await dao.list({ where, limit: 10 })).map((item) => item.feedbackId);

    expect(await ids({ type: "idea" })).toEqual([idea.feedbackId]);
    expect(await ids({ status: "done" })).toEqual([doneBug.feedbackId]);
    expect(await ids({ type: "bug", status: "new" })).toEqual([newBug.feedbackId]);
  });

  it("sets an item's status and answers the item as it is now", async () => {
    const dao = await createDao();
    const item = feedbackRecord();
    await dao.insert(item);

    const updated = await dao.setStatus({ feedbackId: item.feedbackId, status: "read", updatedAt: at(60) });

    expect(updated).toEqual({ ...item, status: "read", updatedAt: at(60) });
    expect(await dao.list({ where: { status: "read" }, limit: 10 })).toEqual([updated]);
  });

  it("throws when the item to update is not there", async () => {
    const dao = await createDao();

    await expect(
      dao.setStatus({ feedbackId: "00000000-0000-4000-a000-0000000000ff", status: "done", updatedAt: at(1) }),
    ).rejects.toThrow(RangeError);
  });

  it("never hands out its own copy, so a caller cannot change what is stored", async () => {
    const dao = await createDao();
    const item = feedbackRecord();
    const stored = await dao.insert(item);

    stored.message = "changed";
    (await dao.list({ where: {}, limit: 10 }))[0].status = "done";

    expect(await dao.list({ where: {}, limit: 10 })).toEqual([item]);
  });
}
