import { HIDDEN_PLAYER_NAME, TOO_YOUNG_MESSAGE } from "@classicade/shared";

/**
 * The words of the year of birth parts (CC-152), each in Hinglish first and English under it, as the profile and the
 * share lines are (ADR-051). Always "tum", never "aap" (owner, 2026-10-20). The Hinglish lines are the builder's
 * drafts for the owner to change. None of them hints at which age changes anything (FTC COPPA FAQ, CC-152 research).
 *
 * @type {Readonly<Record<string, Readonly<{ hi: string, en: string }>>>}
 */
export const AGE_COPY = Object.freeze({
  hint: Object.freeze({
    hi: "Zaroori nahi hai. Sirf saal rakha jaata hai.",
    en: "Optional. Only the year is kept.",
  }),
  tooYoung: Object.freeze({
    hi: "ClassiCade account 13 saal ya usse bade logon ke liye hai. Tum guest ban ke khelte raho.",
    en: TOO_YOUNG_MESSAGE,
  }),
  setOnce: Object.freeze({
    hi: "Yeh saal ek hi baar set hota hai. Galat hai to owner ko batao.",
    en: "It can be set once. To correct it, ask the owner",
  }),
  hiddenOnBoards: Object.freeze({
    hi: `Public leaderboards par tumhara naam ${HIDDEN_PLAYER_NAME} dikhta hai.`,
    en: `On the public leaderboards your name shows as ${HIDDEN_PLAYER_NAME}.`,
  }),
});
