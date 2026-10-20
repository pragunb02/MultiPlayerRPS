import { FRIEND_PRESENCE, FRIEND_REQUEST_VIA, FRIEND_RULES } from "@classicade/shared";

/**
 * The words of the friends pages (CC-052), each in Hinglish first and English under it, as the profile's are
 * (ADR-051). Always "tum", never "aap" (owner, 2026-10-20). The Hinglish lines are the builder's drafts for the owner
 * to change (ADR-066, open point 3).
 *
 * @type {Readonly<Record<string, Readonly<{ hi: string, en: string }>>>}
 */
export const FRIENDS_COPY = Object.freeze({
  guest: Object.freeze({
    hi: "Friends banane ke liye apni progress save karo.",
    en: "Save your progress to add friends. It's free, and your level and wins come with you.",
  }),
  empty: Object.freeze({
    hi: "Abhi tumhare koi friends nahi hain.",
    en: "No friends yet. Add someone you played with, or send a friend your link.",
  }),
  safety: Object.freeze({
    hi: "Sirf unhe add karo jinhe tum sach mein jaante ho.",
    en: "Only add people you know in real life. If someone upsets you, you can block them from a game.",
  }),
  appearOffline: Object.freeze({
    hi: "Offline dikho: tumhare friends tumhe offline dekhenge.",
    en: "Appear offline: your friends see you as offline, wherever you are.",
  }),
  linkIntro: Object.freeze({
    hi: `Yeh link ek friend ko bhejo. Yeh ek hi baar chalega, ${FRIEND_RULES.linkDays} din tak.`,
    en: `Send this link to one friend. It works once, for ${FRIEND_RULES.linkDays} days.`,
  }),
  linkOwn: Object.freeze({
    hi: "Yeh tumhara apna friend link hai.",
    en: "This is your own friend link. Send it to a friend.",
  }),
  linkGone: Object.freeze({
    hi: "Yeh link ab nahi chalta.",
    en: "This friend link has run out or was used already. Ask your friend for a new one.",
  }),
  linkSent: Object.freeze({
    hi: "Request bhej di! Jab woh haan kahenge, tum friends ban jaoge.",
    en: "Request sent. You'll be friends as soon as they say yes.",
  }),
  alreadyFriends: Object.freeze({
    hi: "Tum dono pehle se friends ho.",
    en: "You're friends already.",
  }),
  presenceOnlyFriends: Object.freeze({
    hi: "Sirf tumhare friends dekh sakte hain ki tum online ho. Kaunsa game, yeh koi nahi dekhta.",
    en: "Only your friends see whether you're online or in a game, never which game.",
  }),
});

/**
 * The line a friend link's page opens with. `name` is the maker's, or "A ClassiCade player" when the server hides it.
 *
 * @param {string} name
 * @returns {Readonly<{ hi: string, en: string }>}
 */
export const linkInviteCopy = (name) =>
  Object.freeze({
    hi: `ClassiCade pe ${name} ke friend bano.`,
    en: `${name} wants to be friends on ClassiCade.`,
  });

/** How a friend's presence reads beside their name. Never which room or which game. */
export const PRESENCE_LABEL = Object.freeze({
  [FRIEND_PRESENCE.ONLINE]: "Online",
  [FRIEND_PRESENCE.PLAYING]: "In a game",
  [FRIEND_PRESENCE.OFFLINE]: "Offline",
});

/** How a request came about, beside the name of who sent it. */
export const VIA_LABEL = Object.freeze({
  [FRIEND_REQUEST_VIA.GAME]: "You played together",
  [FRIEND_REQUEST_VIA.LINK]: "Opened your friend link",
});
