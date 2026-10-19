/**
 * Every word of the feedback dialog (CC-290), in one place so the string catalogue (CC-218) can take them over. As in
 * CC-217 (ADR-051), each line is Hinglish first with a short English line under it. These Hinglish lines are drafts
 * for the owner, listed in docs/tickets/CC-290.md.
 */

/** A line in Hinglish and in English. */
const both = (hinglish, english) => Object.freeze({ hinglish, english });

/** The name of each type in the dialog and the console. A new type in FEEDBACK_TYPES needs one line here. */
export const FEEDBACK_TYPE_LABELS = Object.freeze({
  bug: "Bug",
  idea: "Idea",
  other: "Other",
});

/** The name of each status in the console. */
export const FEEDBACK_STATUS_LABELS = Object.freeze({
  new: "New",
  read: "Read",
  done: "Done",
});

export const FEEDBACK_TEXT = Object.freeze({
  open: "Feedback",
  title: both("Apni raay batao", "Send us feedback"),
  typeLegend: both("Kis baare mein hai?", "What is it about?"),
  messageLabel: "Message",
  messageHint: both(
    "Kya hua, ya kya chahiye? Apna naam, phone number ya password mat likhna.",
    "What happened, or what would you like? Please leave out your name, phone number and passwords.",
  ),
  messageMissing: both("Pehle kuch likho.", "Write a message first."),
  replyLabel: "Email me back (optional)",
  replyHint: both("Sirf jawab dene ke liye.", "Only used to reply to you, then deleted within 180 days."),
  context: both(
    "Saath mein page, app version aur device type (phone, tablet ya computer) jaata hai. Aapki pehchaan nahi.",
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
