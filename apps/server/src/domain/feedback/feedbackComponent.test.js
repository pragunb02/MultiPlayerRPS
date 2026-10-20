import { describe, expect, it } from "vitest";
import { safetyFromAdults, safetyWithNoAdults } from "../../testing/fakeSafety.js";
import { createFeedbackAccessor } from "../../data/feedbackAccessor.js";
import { createInMemoryFeedbackDao } from "../../testing/inMemoryFeedbackDao.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { createFeedbackComponent } from "./feedbackComponent.js";

const T0 = Date.UTC(2026, 9, 20, 12);
const ADULT = "user_0123456789abcdef01234567";
const UNKNOWN_AGE = "user_ffffffffffffffffffffffff";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";

/** A component over an in-memory store, where only ADULT is surely 18. */
function setUp() {
  let counter = 0;
  const asked = [];
  const component = createFeedbackComponent({
    feedbackAccessor: createFeedbackAccessor({ feedbackDao: createInMemoryFeedbackDao() }),
    safety: safetyFromAdults(({ playerIds, now }) => {
      asked.push({ playerIds, now });
      return playerIds.filter((id) => id === ADULT);
    }),
    newFeedbackId: () => `00000000-0000-4000-a000-${String(++counter).padStart(12, "0")}`,
  });
  return { component, asked };
}

const feedback = (fields = {}) => ({
  type: "bug",
  message: "The board froze",
  page: "/games/chess/rooms/:code",
  build: "0.1.0+abc1234",
  device: "phone",
  ...fields,
});

describe("feedbackComponent (CC-290)", () => {
  it("stores what was sent with the sender's kind, as new, and never the player id", async () => {
    const { component } = setUp();

    const sent = await component.submit({
      sender: { kind: "guest", playerId: GUEST },
      feedback: feedback(),
      now: T0,
    });

    expect(sent).toEqual({
      feedbackId: "00000000-0000-4000-a000-000000000001",
      status: "new",
      createdAt: T0,
    });
    const { items } = await component.list({ where: {}, limit: 10 });
    expect(items).toEqual([
      {
        ...feedback(),
        feedbackId: sent.feedbackId,
        kind: "guest",
        status: "new",
        hasReplyEmail: false,
        createdAt: T0,
        updatedAt: T0,
      },
    ]);
    expect(JSON.stringify(items)).not.toContain(GUEST);
  });

  it("takes feedback from a visitor without a session", async () => {
    const { component } = setUp();

    await component.submit({ sender: { kind: "visitor" }, feedback: feedback(), now: T0 });

    expect((await component.list({ where: {}, limit: 10 })).items[0].kind).toBe("visitor");
  });

  it("keeps a reply email from an adult account", async () => {
    const { component, asked } = setUp();

    await component.submit({
      sender: { kind: "account", playerId: ADULT },
      feedback: feedback({ replyEmail: "riya@example.com" }),
      now: T0,
    });

    const [listed] = (await component.list({ where: {}, limit: 10 })).items;
    expect(listed).not.toHaveProperty("replyEmail");
    expect(listed.hasReplyEmail).toBe(true);
    expect((await component.get({ feedbackId: listed.feedbackId })).replyEmail).toBe("riya@example.com");
    expect(asked).toEqual([{ playerIds: [ADULT], now: T0 }]);
  });

  it.each([
    ["an account of unknown age", { kind: "account", playerId: UNKNOWN_AGE }],
    ["a guest", { kind: "guest", playerId: GUEST }],
    ["a visitor", { kind: "visitor" }],
  ])(
    "refuses a reply email from %s, who may be a child (ADR-028.1), and stores nothing",
    async (_, sender) => {
      const { component } = setUp();

      const error = await component
        .submit({ sender, feedback: feedback({ replyEmail: "kid@example.com" }), now: T0 })
        .catch((err) => err);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.details).toEqual({ field: "replyEmail" });
      expect((await component.list({ where: {}, limit: 10 })).items).toEqual([]);
    },
  );

  it("asks nobody's age when no reply email is given", async () => {
    const { component, asked } = setUp();

    await component.submit({
      sender: { kind: "account", playerId: UNKNOWN_AGE },
      feedback: feedback(),
      now: T0,
    });

    expect(asked).toEqual([]);
  });

  it("answers whether a sender may ask for a reply", async () => {
    const { component } = setUp();

    expect(await component.canAskForReply({ sender: { kind: "account", playerId: ADULT }, now: T0 })).toBe(
      true,
    );
    expect(
      await component.canAskForReply({ sender: { kind: "account", playerId: UNKNOWN_AGE }, now: T0 }),
    ).toBe(false);
    expect(await component.canAskForReply({ sender: { kind: "guest", playerId: GUEST }, now: T0 })).toBe(
      false,
    );
    expect(await component.canAskForReply({ sender: { kind: "visitor" }, now: T0 })).toBe(false);
  });

  it("lists newest first in pages, and says when there are more", async () => {
    const { component } = setUp();
    for (const at of [1, 2, 3]) {
      await component.submit({ sender: { kind: "visitor" }, feedback: feedback(), now: T0 + at });
    }

    const first = await component.list({ where: {}, limit: 2 });
    const second = await component.list({ where: {}, limit: 2, before: first.next });

    expect(first.items.map((item) => item.createdAt)).toEqual([T0 + 3, T0 + 2]);
    expect(first.next).toEqual({ createdAt: T0 + 2, feedbackId: first.items[1].feedbackId });
    expect(second.items.map((item) => item.createdAt)).toEqual([T0 + 1]);
    expect(second).not.toHaveProperty("next");
  });

  it("filters by type and status", async () => {
    const { component } = setUp();
    await component.submit({ sender: { kind: "visitor" }, feedback: feedback({ type: "idea" }), now: T0 });
    await component.submit({ sender: { kind: "visitor" }, feedback: feedback(), now: T0 + 1 });

    const { items } = await component.list({ where: { type: "idea", status: "new" }, limit: 10 });

    expect(items.map((item) => item.type)).toEqual(["idea"]);
  });

  it("moves an item to another status", async () => {
    const { component } = setUp();
    const { feedbackId } = await component.submit({
      sender: { kind: "visitor" },
      feedback: feedback(),
      now: T0,
    });

    const item = await component.setStatus({ feedbackId, status: "done", now: T0 + 5 });

    expect(item).toEqual(expect.objectContaining({ feedbackId, status: "done", updatedAt: T0 + 5 }));
  });

  it("answers NotFoundError for a status change on an item that is not there", async () => {
    const { component } = setUp();

    await expect(
      component.setStatus({ feedbackId: "00000000-0000-4000-a000-0000000000ff", status: "read", now: T0 }),
    ).rejects.toThrow(NotFoundError);
  });

  it("lets anyone leave a reply email once the owner opens it to everyone", async () => {
    const component = createFeedbackComponent({
      feedbackAccessor: createFeedbackAccessor({ feedbackDao: createInMemoryFeedbackDao() }),
      safety: safetyFromAdults(async () => new Set()),
      replyEmailOnlyForAdults: false,
    });

    await component.submit({
      sender: { kind: "visitor" },
      feedback: feedback({ replyEmail: "riya@example.com" }),
      now: T0,
    });

    expect((await component.list({ where: {}, limit: 1 })).items[0].hasReplyEmail).toBe(true);
  });

  it("masks emails and phone numbers in the message before it is stored, and keeps the reply email as given", async () => {
    const { component } = setUp();

    const { feedbackId } = await component.submit({
      sender: { kind: "account", playerId: ADULT },
      feedback: feedback({
        message: "Call +91 98765 43210 or mail riya@example.com",
        replyEmail: "riya@example.com",
      }),
      now: T0,
    });

    const stored = await component.get({ feedbackId });
    expect(stored.message).toBe("Call [phone removed] or mail [email removed]");
    expect(stored.replyEmail).toBe("riya@example.com");
  });

  it("reads one item with everything, and answers NotFoundError for one that is not there", async () => {
    const { component } = setUp();
    const { feedbackId } = await component.submit({
      sender: { kind: "visitor" },
      feedback: feedback(),
      now: T0,
    });

    expect(await component.get({ feedbackId })).toEqual(
      expect.objectContaining({ feedbackId, ...feedback() }),
    );
    await expect(component.get({ feedbackId: "00000000-0000-4000-a000-0000000000ff" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("deletes an item for good, and answers NotFoundError when it is not there", async () => {
    const { component } = setUp();
    const { feedbackId } = await component.submit({
      sender: { kind: "visitor" },
      feedback: feedback(),
      now: T0,
    });

    await component.remove({ feedbackId });

    expect((await component.list({ where: {}, limit: 10 })).items).toEqual([]);
    await expect(component.remove({ feedbackId })).rejects.toThrow(NotFoundError);
  });

  it("answers a status change without the reply email, as the list does", async () => {
    const { component } = setUp();
    const { feedbackId } = await component.submit({
      sender: { kind: "account", playerId: ADULT },
      feedback: feedback({ replyEmail: "riya@example.com" }),
      now: T0,
    });

    const item = await component.setStatus({ feedbackId, status: "read", now: T0 });

    expect(item).not.toHaveProperty("replyEmail");
    expect(item.hasReplyEmail).toBe(true);
  });

  it("checks its dependencies when it is made", () => {
    expect(() =>
      createFeedbackComponent({ feedbackAccessor: undefined, safety: safetyWithNoAdults() }),
    ).toThrow();
    expect(() => createFeedbackComponent({ feedbackAccessor: {}, safety: {} })).toThrow();
  });
});
