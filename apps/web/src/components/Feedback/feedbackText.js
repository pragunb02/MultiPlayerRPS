import { FEEDBACK_STATUS, FEEDBACK_TYPE } from "@classicade/shared";

/**
 * Every word of the feedback dialog (CC-290), in one place so the string catalogue (CC-218) can take them over. As in
 * CC-217 (ADR-051), each line is Hinglish first with a short English line under it. The owner accepted these lines on
 * 2026-10-20, and the app speaks to the player as tum, never aap (docs/tickets/CC-290.md).
 */

/** A line in Hinglish and in English. */
const both = (hinglish, english) => Object.freeze({ hinglish, english });

/** The name of each type in the dialog and the console. A new type in FEEDBACK_TYPES needs one line here. */
export const FEEDBACK_TYPE_LABELS = Object.freeze({
  [FEEDBACK_TYPE.BUG]: "Bug",
  [FEEDBACK_TYPE.IDEA]: "Idea",
  [FEEDBACK_TYPE.OTHER]: "Other",
});

/** The name of each status in the console. */
export const FEEDBACK_STATUS_LABELS = Object.freeze({
  [FEEDBACK_STATUS.NEW]: "New",
  [FEEDBACK_STATUS.READ]: "Read",
  [FEEDBACK_STATUS.DONE]: "Done",
});

export const FEEDBACK_TEXT = Object.freeze({
  open: "Feedback",
  title: both("Apni raay batao", "Send us feedback"),
  typeLegend: both("Kis baare mein hai?", "What is it about?"),
  messageLabel: "Message",
  messageHint: both(
    "Kya hua, ya kya chahiye? Apna naam ya password mat likhna. Email aur phone number save hone se pehle hata diye jaate hain.",
    "What happened, or what would you like? Please leave out your name and passwords. Emails and phone numbers are removed before we save it.",
  ),
  messageMissing: both("Pehle kuch likho.", "Write a message first."),
  replyLabel: "Email me back (optional)",
  replyHint: both("Sirf jawab dene ke liye.", "Only used to reply to you, then deleted within 180 days."),
  context: both(
    "Saath mein page, app version aur device type (phone, tablet ya computer) jaata hai. Tumhari pehchaan nahi.",
    "We also send the page, the app version and your device type (phone, tablet or computer). Nothing that says who you are.",
  ),
  send: "Send",
  sending: "Sending…",
  cancel: "Cancel",
  sentTitle: both("Shukriya!", "Thank you!"),
  sentBody: both("Hum har message padhte hain.", "We read every message."),
  another: "Send another",
  close: "Close",
});

/**
 * The live count under the message: how much of the longest message is used.
 *
 * @param {number} used
 * @param {number} max
 */
export const countText = (used, max) => `${used} / ${max}`;
