import { describe, expect, it } from "vitest";
import { parseEmail, parsePassword, parseUsername } from "../apps/server/src/models/credentials.js";
import { longNameAccount, newAccount } from "./personas.js";

// The browser tests sign up with these accounts. A name the server refuses fails a browser test now and then, far
// from the cause, so the server's own rules check them here (CC-237).
describe("newAccount (CC-237)", () => {
  it("always makes a username, email and password that sign-up accepts", () => {
    for (let i = 0; i < 20_000; i += 1) {
      const account = newAccount();
      expect(parseUsername(account.username)).toBe(account.username);
      expect(parseEmail(account.email)).toBe(account.email);
      expect(parsePassword(account.password)).toBe(account.password);
    }
  });

  it("is accepted whatever the clock and the random digits are", () => {
    for (const now of [0, 1, 1_760_000_000_000, 99_999_999_999_999]) {
      for (const random of [0, 42, 5000, 9999]) {
        expect(() => parseUsername(newAccount({ now, random }).username)).not.toThrow();
      }
    }
  });

  it("is 15 characters, from the clock in ms and 4 random digits", () => {
    expect(newAccount({ now: 1_760_712_345_678, random: 42 }).username).toBe("riya_3456780042");
    expect(newAccount({ now: 7, random: 3 }).username).toBe("riya_0000070003");
  });

  it("no longer makes names like the one that failed: letters in the tag could spell a reserved word", () => {
    expect(() => parseUsername("riya_cp8um06316")).toThrow("That name is reserved");
  });
});

describe("longNameAccount (CC-256)", () => {
  it("is the longest name sign-up allows, 20 characters, and sign-up accepts it", () => {
    for (let i = 0; i < 2_000; i += 1) {
      const account = longNameAccount();
      expect(account.username).toHaveLength(20);
      expect(parseUsername(account.username)).toBe(account.username);
      expect(parseEmail(account.email)).toBe(account.email);
      expect(parsePassword(account.password)).toBe(account.password);
    }
  });

  it("is ten Ws and the same tag as newAccount, so two tests never share a name or an email", () => {
    const options = { now: 1_760_712_345_678, random: 42 };

    expect(longNameAccount(options)).toEqual({
      username: "WWWWWWWWWW3456780042",
      email: "w.3456780042@example.com",
      password: newAccount(options).password,
    });
  });
});
