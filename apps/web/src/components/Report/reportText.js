import { REPORT_REASON } from "@classicade/shared";

/**
 * Every word of the report dialog (CC-044, ADR-071), in one place so the string catalogue (CC-218) can take them over.
 * Each line is Hinglish first with a short English line under it (ADR-051), and speaks to the player as tum, never
 * aap (owner, 2026-10-20). The Hinglish lines are the builder's drafts for the owner to change.
 */

/** A line in Hinglish and in English. */
const both = (hinglish, english) => Object.freeze({ hinglish, english });

/** What each reason is called in the dialog and the console. A new reason in REPORT_REASONS needs one line here. */
export const REPORT_REASON_LABELS = Object.freeze({
  [REPORT_REASON.NAME]: both("Ganda ya galat naam", "Offensive name"),
  [REPORT_REASON.CHEATING]: both("Cheating ya jaan-boojh ke der", "Cheating or stalling"),
  [REPORT_REASON.HARASSMENT]: both(
    "Emotes ya requests se pareshan karna",
    "Harassment through emotes or requests",
  ),
  [REPORT_REASON.OTHER]: both("Kuch aur", "Something else"),
});

/**
 * The dialog's words for reporting one player.
 *
 * @param {string} name  the reported player's display name, as the page shows it
 */
export const reportText = (name) =>
  Object.freeze({
    title: both(`${name} ko report karo`, `Report ${name}`),
    reasonLegend: both("Kya hua?", "What happened?"),
    noteLabel: "Anything else? (optional)",
    noteHint: both(
      "Apna naam, phone ya address mat likhna. Email aur phone number save hone se pehle hata diye jaate hain.",
      "Leave out your name, phone and address. Emails and phone numbers are removed before we save it.",
    ),
    reasonMissing: both("Pehle ek wajah chuno.", "Pick a reason first."),
    send: "Send report",
    sending: "Sending…",
    cancel: "Cancel",
    sentTitle: both("Shukriya, humein mil gaya.", "Thanks, we got it."),
    sentBody: both(
      `Hum har report dekhte hain. ${name} ko nahi bataya jaata ki tumne report kiya.`,
      `We look at every report. ${name} is not told that you reported them.`,
    ),
    help: both(
      "Agar tumhe dar lag raha hai, kisi bade ko batao jis par tum bharosa karte ho.",
      "If you feel unsafe, tell a grown-up you trust. Childline: 1098. Cyber crime: cybercrime.gov.in or 1930.",
    ),
    blockToo: `Block ${name} too`,
    blocking: "Blocking…",
    blocked: both(`Tumne ${name} ko block kar diya.`, `You blocked ${name}.`),
    close: "Close",
  });
