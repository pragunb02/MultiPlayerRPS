/**
 * The words of invites to friends (CC-052 part 2), each in Hinglish first and English under it, as the friends pages
 * are (ADR-051). Always "tum", never "aap" (owner, 2026-10-20). The Hinglish lines are the builder's drafts for the
 * owner to change. Buttons stay in English, as everywhere else on the site.
 *
 * Every name here is a friend's, which friends always see.
 */

/** @param {string} hi @param {string} en */
const both = (hi, en) => Object.freeze({ hi, en });

export const INVITE_COPY = Object.freeze({
  pickGame: (name) =>
    both(`${name} ke saath kaunsa game khelna hai?`, `Which game do you want to play with ${name}?`),
  /** After sending: the friend is on the site, on a page that is not a game. */
  sentOnline: (name) =>
    both(`Invite bhej diya! ${name} ise abhi dekhenge.`, `Invite sent. ${name} sees it now.`),
  /** After sending: the friend is in a game, which nothing interrupts. */
  sentPlaying: (name) =>
    both(
      `${name} abhi ek game mein hain. Game khatam hote hi unhe tumhara invite dikhega.`,
      `${name} is in a game. They'll see your invite as soon as it ends.`,
    ),
  /** After sending: the friend is offline. */
  sentOffline: (name) =>
    both(
      `${name} abhi offline hain. Invite 24 ghante unke inbox mein rahega. Chaho to WhatsApp pe bhi bhej do.`,
      `${name} is offline. Your invite waits in their inbox for 24 hours. You can send it on WhatsApp too.`,
    ),
  /** Another friend took the sender's invite to the same game first (scenario 6). */
  gameFilled: (name) =>
    both(
      `Game bhar gaya: ${name} kisi aur ke saath khel rahe hain. Unhe phir se invite karo?`,
      `Game filled: ${name} is playing someone else now. Invite them again?`,
    ),
  /** The friend who took an invite, waiting in the room for its sender (scenario 4). */
  isntHere: (name) =>
    both(
      `${name} abhi yahan nahi hain. Humne unhe bata diya hai.`,
      `${name} isn't here right now. We've told them.`,
    ),
  keepOrPlay: (name) =>
    both(
      `Chaho to invite baad ke liye rakh lo, ya tab tak Pip ke saath khelo. ${name} wapas aayenge to unhe dikhega.`,
      `Keep the invite for later, or play Pip meanwhile. ${name} gets it as soon as they're back.`,
    ),
  kept: (name) =>
    both(
      `Invite rakh liya. ${name} wapas aayenge to unhe dikhega.`,
      `Kept for later. ${name} will see your invite when they're back.`,
    ),
  /** The sender's own invite page. */
  yours: (name, game) =>
    both(
      `${name} ko tumhara ${game} invite mil gaya hai.`,
      `Your ${game} invite to ${name} is waiting for them.`,
    ),
  lasts: both(
    "Invite 24 ghante chalega. Woh haan kahenge to hum tumhe kisi bhi page pe bata denge.",
    "It lasts 24 hours. We'll tell you on any page when they say yes.",
  ),
  /** A forwarded invite, opened by anyone but the friend it was sent to. */
  forSomeoneElse: both(
    "Yeh invite kisi aur ke liye hai. Agar tumhare liye hai, to log in karo.",
    "This invite is for someone else. If it's for you, log in to accept it.",
  ),
});
