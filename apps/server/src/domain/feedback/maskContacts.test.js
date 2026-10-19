import { describe, expect, it } from "vitest";
import { EMAIL_MASK, maskContacts, PHONE_MASK } from "./maskContacts.js";

describe("maskContacts: emails and phone numbers in a message never reach the database (CC-290)", () => {
  it.each([
    ["mail me at riya@example.com please", `mail me at ${EMAIL_MASK} please`],
    ["Riya.Sharma+games@mail.co.in.", `${EMAIL_MASK}.`],
    ["two: a@b.in, c.d@e-f.org", `two: ${EMAIL_MASK}, ${EMAIL_MASK}`],
  ])("masks the email in %j", (message, masked) => {
    expect(maskContacts(message)).toBe(masked);
  });

  it.each([
    ["call +91 98765 43210 now", `call ${PHONE_MASK} now`],
    ["+91 9876543210", PHONE_MASK],
    ["+91-98765-43210", PHONE_MASK],
    ["+919876543210", PHONE_MASK],
    ["919876543210", PHONE_MASK],
    ["09876543210", PHONE_MASK],
    ["my number is 9876543210.", `my number is ${PHONE_MASK}.`],
    ["98765 43210", PHONE_MASK],
    ["98765-43210", PHONE_MASK],
    ["987 654 3210", PHONE_MASK],
    ["landline (022) 2345 6789", `landline ${PHONE_MASK}`],
    ["+1 (415) 555-0132", PHONE_MASK],
  ])("masks the phone number in %j", (message, masked) => {
    expect(maskContacts(message)).toBe(masked);
  });

  it.each([
    "I scored 1000 points in 3 games",
    "The match on 2026-10-20 at 18:30 froze",
    "Room code AB2CD3 broke after 45 seconds",
    "best of 5, I won 3-2",
    "build 0.1.0+abc1234",
    "an @ sign alone, or me@home without a dot",
    "123456789 is only nine digits",
  ])("leaves %j as it is", (message) => {
    expect(maskContacts(message)).toBe(message);
  });

  it("keeps the new lines and everything around a mask", () => {
    expect(maskContacts("Line one\nphone 9876543210\nmail x@y.com")).toBe(
      `Line one\nphone ${PHONE_MASK}\nmail ${EMAIL_MASK}`,
    );
  });
});
