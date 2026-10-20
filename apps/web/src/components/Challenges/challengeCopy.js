/**
 * The words of challenges, the request popups and the inbox (CC-139, CC-207), each in Hinglish first and English
 * under it, as the profile pages are (ADR-051). Always "tum", never "aap" (owner, 2026-10-20). The Hinglish lines are
 * the builder's drafts for the owner to change. Buttons stay in English, as everywhere else on the site.
 *
 * A name the viewer may not see is "" (ADR-028.7), and each language then says "a ClassiCade player" its own way.
 */

const SOMEONE = Object.freeze({ hi: "Ek ClassiCade player", en: "A ClassiCade player" });
const nameIn = (name, language) => (name === "" ? SOMEONE[language] : name);
/** One line in both languages, made from the same name. */
const line = (name, write) =>
  Object.freeze({ hi: write(nameIn(name, "hi"), "hi"), en: write(nameIn(name, "en"), "en") });

export const CHALLENGE_COPY = Object.freeze({
  /** @param {string} name @param {string} game */
  challengesYou: (name, game) =>
    line(name, (who, language) =>
      language === "hi"
        ? `${who} ne tumhe ${game} ka challenge diya hai.`
        : `${who} challenges you to ${game}.`,
    ),
  /** @param {string} name @param {string} game */
  tookYours: (name, game) =>
    line(name, (who, language) =>
      language === "hi"
        ? `${who} ne tumhara ${game} challenge le liya. Chalo, khelo!`
        : `${who} took your ${game} challenge. They are waiting for you.`,
    ),
  /** @param {string} name */
  declinedYours: (name) =>
    line(name, (who, language) =>
      language === "hi"
        ? `${who} abhi nahi khel sakte. Baad mein phir try karo.`
        : `${who} can't play right now.`,
    ),
  /** @param {string} game */
  yoursIsOpen: (game) =>
    Object.freeze({
      hi: `Tumhara ${game} challenge tayyar hai. Link bhejo: jo pehle kholega, wahi tumse khelega.`,
      en: `Your ${game} challenge is ready. Send the link: whoever opens it first plays you.`,
    }),
  lasts: Object.freeze({
    hi: "Link 24 ghante chalega. Koi le le, to hum tumhe bata denge.",
    en: "The link works for 24 hours. We'll tell you on any page when someone takes it.",
  }),
  tookIt: Object.freeze({ hi: "Tumne yeh challenge le liya.", en: "You took this challenge." }),
  taken: Object.freeze({
    hi: "Yeh challenge kisi aur ne le liya.",
    en: "Someone already took this challenge.",
  }),
  withdrawn: Object.freeze({ hi: "Yeh challenge wapas le liya gaya.", en: "This challenge was taken back." }),
  over: Object.freeze({ hi: "Yeh challenge khatam ho gaya.", en: "This challenge is over." }),
  expired: Object.freeze({
    hi: "Yeh challenge expire ho gaya. Challenge sirf 24 ghante chalta hai.",
    en: "This challenge has expired. A challenge lasts 24 hours.",
  }),
  notFound: Object.freeze({
    hi: "Yeh challenge nahi mila. Shayad expire ho gaya.",
    en: "We couldn't find this challenge. It may have expired: a challenge lasts 24 hours.",
  }),
  makeYourOwn: Object.freeze({
    hi: "Apna challenge banao aur dost ko bhejo.",
    en: "Make your own challenge and send it to a friend.",
  }),
  signInFirst: Object.freeze({
    hi: "Khelne ke liye guest bano, ya log in karo.",
    en: "Play as a guest, or log in to keep your progress.",
  }),
});
