import { describe, expect, it } from "vitest";
import {
  AUDIENCES,
  BOARD_NAMES,
  EMOTES,
  FRIENDS_MODES,
  agePolicyFor,
  audienceOf,
  clientPolicyOf,
  isQuietTime,
} from "./agePolicy.js";

const QUIET = Object.freeze({ timeZone: "Asia/Kolkata", from: "22:00", to: "07:00" });

// One row per audience: every field the social features read, so a change to any default fails here first.
const TABLE = [
  {
    audience: AUDIENCES.ADULT,
    expected: {
      treatedAsMinor: false,
      canFollow: true,
      canBeFollowed: true,
      friendsMode: FRIENDS_MODES.MUTUAL,
      emotes: EMOTES.ON,
      quietHours: null,
      shareCardName: true,
      maxOwnedCircleSize: 50,
      publicProfile: true,
      profileLink: true,
      boardName: BOARD_NAMES.OWN,
      replyEmail: true,
      personalisation: true,
    },
  },
  {
    audience: AUDIENCES.MINOR,
    expected: {
      treatedAsMinor: true,
      canFollow: false,
      canBeFollowed: false,
      friendsMode: FRIENDS_MODES.MUTUAL_KNOWN,
      emotes: EMOTES.OFF,
      quietHours: QUIET,
      shareCardName: false,
      maxOwnedCircleSize: 10,
      publicProfile: false,
      profileLink: false,
      boardName: BOARD_NAMES.HIDDEN,
      replyEmail: false,
      personalisation: false,
    },
  },
  {
    audience: AUDIENCES.UNKNOWN,
    expected: {
      treatedAsMinor: true,
      canFollow: false,
      canBeFollowed: false,
      friendsMode: FRIENDS_MODES.MUTUAL_KNOWN,
      emotes: EMOTES.OFF,
      quietHours: QUIET,
      shareCardName: false,
      maxOwnedCircleSize: 10,
      publicProfile: false,
      profileLink: false,
      boardName: BOARD_NAMES.HIDDEN,
      replyEmail: false,
      personalisation: false,
    },
  },
  {
    audience: AUDIENCES.GUEST,
    expected: {
      treatedAsMinor: true,
      canFollow: false,
      canBeFollowed: false,
      friendsMode: FRIENDS_MODES.NONE,
      emotes: EMOTES.OFF,
      quietHours: QUIET,
      shareCardName: false,
      maxOwnedCircleSize: 10,
      publicProfile: false,
      profileLink: false,
      boardName: BOARD_NAMES.SERVER_GIVEN,
      replyEmail: false,
      personalisation: false,
    },
  },
];

describe("agePolicyFor (CC-152, ADR-028, ADR-048 amended)", () => {
  it.each(TABLE)("gives $audience exactly the safe defaults of its row", ({ audience, expected }) => {
    expect(agePolicyFor(audience)).toEqual({ audience, ...expected });
  });

  it("is frozen, quiet hours too, so no feature can loosen a default for everyone", () => {
    const minor = agePolicyFor(AUDIENCES.MINOR);
    expect(Object.isFrozen(minor)).toBe(true);
    expect(Object.isFrozen(minor.quietHours)).toBe(true);
  });

  it("refuses an audience it does not know instead of guessing", () => {
    expect(() => agePolicyFor("teen")).toThrow(TypeError);
  });

  it("gives an account of unknown age the minor's defaults in every field but the audience (ADR-028.1)", () => {
    const { audience: _u, ...unknown } = agePolicyFor(AUDIENCES.UNKNOWN);
    const { audience: _m, ...minor } = agePolicyFor(AUDIENCES.MINOR);
    expect(unknown).toEqual(minor);
  });
});

describe("audienceOf", () => {
  it.each([
    [{ kind: "account", ageGroup: "adult" }, AUDIENCES.ADULT],
    [{ kind: "account", ageGroup: "minor" }, AUDIENCES.MINOR],
    [{ kind: "account", ageGroup: "unknown" }, AUDIENCES.UNKNOWN],
    [{ kind: "account" }, AUDIENCES.UNKNOWN],
    [{ kind: "guest" }, AUDIENCES.GUEST],
    [{ kind: "guest", ageGroup: "adult" }, AUDIENCES.GUEST],
    [{ kind: "bot" }, AUDIENCES.UNKNOWN],
    [{ kind: "deleted" }, AUDIENCES.UNKNOWN],
  ])("%o is %s", (player, audience) => {
    expect(audienceOf(player)).toBe(audience);
  });
});

describe("isQuietTime: no push or email from 22:00 to 07:00 India time", () => {
  const minor = agePolicyFor(AUDIENCES.MINOR);
  const adult = agePolicyFor(AUDIENCES.ADULT);
  // India is UTC+05:30 all year, so 22:00 IST is 16:30 UTC and 07:00 IST is 01:30 UTC.
  it.each([
    ["2026-10-20T16:29:59.999Z", false],
    ["2026-10-20T16:30:00.000Z", true],
    ["2026-10-20T20:00:00.000Z", true],
    ["2026-10-21T01:29:59.999Z", true],
    ["2026-10-21T01:30:00.000Z", false],
    ["2026-10-21T06:30:00.000Z", false],
  ])("at %s a minor is quiet: %s", (at, quiet) => {
    expect(isQuietTime(minor, Date.parse(at))).toBe(quiet);
  });

  it("is never quiet for an adult", () => {
    expect(isQuietTime(adult, Date.parse("2026-10-20T20:00:00.000Z"))).toBe(false);
  });
});

describe("clientPolicyOf", () => {
  it("gives the player their own flags and never their age group or the rules behind them", () => {
    const view = clientPolicyOf(agePolicyFor(AUDIENCES.MINOR));
    expect(view).toEqual({
      canFollow: false,
      friendsMode: FRIENDS_MODES.MUTUAL_KNOWN,
      emotes: EMOTES.OFF,
      quietHours: QUIET,
      shareCardName: false,
      maxOwnedCircleSize: 10,
      publicProfile: false,
      boardName: BOARD_NAMES.HIDDEN,
    });
    expect(JSON.stringify(view)).not.toMatch(/minor|adult|unknown|guest|audience/i);
  });
});
