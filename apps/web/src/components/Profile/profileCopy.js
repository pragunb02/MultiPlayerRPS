/**
 * The words of the profile pages and the avatar picker (CC-034), each in Hinglish first and English under it, as
 * the share lines are (ADR-051). Always "tum", never "aap" (owner, 2026-10-20). The Hinglish lines are the builder's
 * drafts for the owner to change (Social and sharing domain §4.5, point 3).
 *
 * @type {Readonly<Record<string, Readonly<{ hi: string, en: string }>>>}
 */
export const PROFILE_COPY = Object.freeze({
  hidden: Object.freeze({
    hi: "Is player ka profile chhupa hua hai.",
    en: "This player's profile is hidden. Profiles of guests, players under 18 and anyone who hasn't said their age stay hidden.",
  }),
  private: Object.freeze({
    hi: "Yeh profile private hai.",
    en: "This profile is private.",
  }),
  notFound: Object.freeze({
    hi: "Yeh player nahi mila.",
    en: "We couldn't find this player.",
  }),
  own: Object.freeze({
    hi: "Doosre players tumhara profile aise dekhte hain.",
    en: "This is how other players see your profile.",
  }),
  pickAvatar: Object.freeze({
    hi: "Apna avatar chuno.",
    en: "Pick your avatar. Everyone you play with sees it beside your name.",
  }),
  guestAvatar: Object.freeze({
    hi: "Sign up karoge to tumhara avatar saath aayega.",
    en: "Your avatar comes with you when you sign up.",
  }),
  makePublic: Object.freeze({
    hi: "Tumhara profile sabko dikhe?",
    en: "Show your profile to everyone: your name, avatar, level, games, wins and chess rating. Never your email or age.",
  }),
  publicNow: Object.freeze({
    hi: "Tumhara profile ab sabko dikhta hai.",
    en: "Your profile is public.",
  }),
  privateNow: Object.freeze({
    hi: "Tumhara profile private hai.",
    en: "Your profile is private. Others see only your name and avatar.",
  }),
  locked: Object.freeze({
    hi: "Jab tak pakka na ho ki tum 18 ya usse bade ho, tumhara profile chhupa rahega.",
    en: "Your profile stays hidden until we know you are 18 or older. That keeps younger players safe.",
  }),
  link: Object.freeze({
    hi: "Tumhare profile ka link",
    en: "Your profile link",
  }),
});
