import { randomUUID } from "node:crypto";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { maskContacts } from "./maskContacts.js";

/**
 * Who may leave an email for a reply. Unknown age counts as a child (ADR-028.1), and a child's email is personal data
 * we would need a parent's consent for, so only an account whose birth year makes it surely 18 may. The owner may
 * open it to everyone after the lawyer's review by setting this to false (ADR-059).
 */
export const REPLY_EMAIL_ONLY_FOR_ADULTS = true;

/**
 * @typedef {{ kind: "visitor" } | { kind: "guest" | "account", playerId: string }} FeedbackSender   who is sending,
 *   from the session. The player id is used only to ask the age and is never stored
 * @typedef {{ type: string, message: string, page: string, build: string, device: string, replyEmail?: string }} FeedbackInput
 *   already checked for shape by the service layer
 * @typedef {{ createdAt: number, feedbackId: string }} FeedbackCursor   the last item of a page
 */

/**
 * An item as the inbox lists it: everything but the reply email, which only the item's own view shows
 * (ADR-059). `hasReplyEmail` says whether there is one.
 */
const listed = ({ replyEmail, ...item }) => Object.freeze({ ...item, hasReplyEmail: replyEmail !== undefined });

/**
 * In-app feedback (CC-290, ADR-059). Anyone can send it, visitors included. Nothing stored names the player: only
 * the kind of sender, a route pattern, the build and a coarse device. The owner reads it in the console.
 *
 * @param {{
 *   feedbackAccessor: ReturnType<typeof import("../../data/feedbackAccessor.js").createFeedbackAccessor>,
 *   ages: Pick<ReturnType<typeof import("../accounts/accountComponent.js").createAccountComponent>, "adultsAmong">,
 *   newFeedbackId?: () => string,
 *   replyEmailOnlyForAdults?: boolean,
 * }} deps  `replyEmailOnlyForAdults` is REPLY_EMAIL_ONLY_FOR_ADULTS unless a test says otherwise
 */
export function createFeedbackComponent({
  feedbackAccessor,
  ages,
  newFeedbackId = randomUUID,
  replyEmailOnlyForAdults = REPLY_EMAIL_ONLY_FOR_ADULTS,
}) {
  assertDefined(feedbackAccessor, "feedbackAccessor");
  assertFunction(ages?.adultsAmong, "ages.adultsAmong");
  assertFunction(newFeedbackId, "newFeedbackId");

  /** @param {{ sender: FeedbackSender, now: number }} query */
  async function canAskForReply({ sender, now }) {
    if (!replyEmailOnlyForAdults) return true;
    if (sender.kind !== "account") return false;
    return (await ages.adultsAmong({ playerIds: [sender.playerId], now })).has(sender.playerId);
  }

  return Object.freeze({
    /**
     * Whether the dialog may offer "Email me back" to this sender.
     *
     * @returns {Promise<boolean>}
     */
    canAskForReply,

    /**
     * Stores one item as new. Email addresses and phone numbers in the message are masked first, so contact details
     * typed by mistake never reach the database. The reply email, which the player chose to give, is kept as given.
     *
     * @param {{ sender: FeedbackSender, feedback: FeedbackInput, now: number }} input
     * @returns {Promise<Readonly<{ feedbackId: string, status: string, createdAt: number }>>}
     * @throws {ValidationError} with `details.field` "replyEmail" when the sender may not leave an email
     */
    async submit({ sender, feedback, now }) {
      if (feedback.replyEmail !== undefined && !(await canAskForReply({ sender, now }))) {
        throw new ValidationError("Email replies are only for signed-in players aged 18 or over", {
          details: { field: "replyEmail" },
        });
      }
      const item = await feedbackAccessor.add({
        ...feedback,
        message: maskContacts(feedback.message),
        feedbackId: newFeedbackId(),
        kind: sender.kind,
        at: now,
      });
      return Object.freeze({ feedbackId: item.feedbackId, status: item.status, createdAt: item.createdAt });
    },

    /**
     * The owner's inbox, newest first, without reply emails. One more item than asked is read, to know whether an
     * older page exists.
     *
     * @param {{ where: { type?: string, status?: string }, limit: number, before?: FeedbackCursor }} query
     * @returns {Promise<Readonly<{ items: ReadonlyArray<Readonly<import("../../data/feedbackAccessor.js").Feedback>>, next?: FeedbackCursor }>>}
     *   `next` only when there are older items
     */
    async list({ where, limit, before }) {
      const found = await feedbackAccessor.list({
        where,
        limit: limit + 1,
        ...(before !== undefined && { before }),
      });
      const items = Object.freeze(found.slice(0, limit).map(listed));
      const last = items.at(-1);
      return Object.freeze({
        items,
        ...(found.length > limit && { next: { createdAt: last.createdAt, feedbackId: last.feedbackId } }),
      });
    },

    /**
     * One item with everything it holds, the reply email included, for its own view in the inbox.
     *
     * @param {{ feedbackId: string }} query
     * @throws {NotFoundError} when there is no such item
     */
    get: ({ feedbackId }) => feedbackAccessor.get(feedbackId),

    /**
     * Moves an item to another status, and answers it as the list shows it.
     *
     * @param {{ feedbackId: string, status: string, now: number }} change
     * @throws {NotFoundError} when there is no such item
     */
    setStatus: async ({ feedbackId, status, now }) =>
      listed(await feedbackAccessor.setStatus({ feedbackId, status, at: now })),

    /**
     * Deletes an item for good, so the owner can remove anything that holds personal details.
     *
     * @param {{ feedbackId: string }} query
     * @throws {NotFoundError} when there is no such item
     */
    async remove({ feedbackId }) {
      if (!(await feedbackAccessor.remove(feedbackId))) {
        throw new NotFoundError("No such feedback");
      }
    },
  });
}
