import { PROFILE_HANDLE_ALPHABET } from "./profiles.js";

/**
 * Challenges (CC-139, ADR-069): one player picks a game and its options and gets a link of its own, which lasts a
 * day and outlives any room. Whoever opens it can take the challenge, and a room is made for both of them. CC-052
 * adds challenges to one friend, named by their profile handle.
 */

/**
 * Where a challenge stands. It starts open. It ends accepted when someone took it and a room was made with both
 * players seated, declined by the one person it was for, withdrawn by its creator, or expired when its day is over.
 */
export const CHALLENGE_STATES = Object.freeze({
  OPEN: "open",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  EXPIRED: "expired",
  WITHDRAWN: "withdrawn",
});

/** How long a challenge stays open: one day (CC-052 scenario 3). */
export const CHALLENGE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * How long a challenge shows as a popup on a page before it moves to the inbox, counted from when the player could
 * first see it (CC-207). Rematch and draw requests end on their own within this time.
 */
export const CHALLENGE_POPUP_MS = 60 * 1000;

/** The limits on making challenges (CC-052 rule 2). The server checks them, the page explains them. */
export const CHALLENGE_LIMITS = Object.freeze({
  /** challenges one player may have open at once */
  openPerSender: 3,
  /** how long after a challenge to one person the next one to the same person may be made */
  samePersonEveryMs: 10 * 60 * 1000,
});

/** Why the server refused to make a challenge, in `details.reason` of the 409 answer. */
export const CHALLENGE_LIMIT_REASONS = Object.freeze({
  OPEN: "open-challenges",
  SAME_PERSON: "same-person",
});

/** 20 letters of 5 bits each, 100 random bits, in the profile handle alphabet. Never the length of a handle. */
export const CHALLENGE_ID_LENGTH = 20;

/** The shape of every challenge id. A player id, a room code or a profile handle never has it. */
export const CHALLENGE_ID_PATTERN = new RegExp(`^[${PROFILE_HANDLE_ALPHABET}]{${CHALLENGE_ID_LENGTH}}$`);

/** @param {unknown} value */
export const isChallengeId = (value) => typeof value === "string" && CHALLENGE_ID_PATTERN.test(value);

/** Why the server refused to take, answer or change a challenge, in `details.reason` (CC-350). */
export const CHALLENGE_REFUSALS = Object.freeze({
  /** someone else was taking it at the same moment, so trying again may work */
  BEING_TAKEN: "being-taken",
  /** the player made it */
  OWN: "own-challenge",
  /** it was sent to someone else */
  NOT_FOR_YOU: "not-for-you",
  /** only the player who made it can take it back */
  NOT_YOURS: "not-yours",
});
