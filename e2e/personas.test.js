import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEmail, parsePassword, parseUsername } from "../apps/server/src/models/credentials.js";
import { newAccount } from "./personas.js";

// The browser tests sign up with these accounts. A name the server refuses fails a browser test now and then, far
// from the cause, so the server's own rules check them here (CC-237).
describe("newAccount (CC-237)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("always makes a username, email and password that sign-up accepts", () => {
    for (let i = 0; i < 20_000; i += 1) {
      const account = newAccount();
      expect(parseUsername(account.username)).toBe(account.username);
      expect(parseEmail(account.email)).toBe(account.email);
      expect(parsePassword(account.password)).toBe(account.password);
    }
  });

  it("is accepted whatever the clock and the random digits are", () => {
    const clocks = [0, 1, 1_760_000_000_000, 99_999_999_999_999];
    const randoms = [0, 0.5, 0.9999];
    for (const clock of clocks) {
      for (const random of randoms) {
        vi.spyOn(Date, "now").mockReturnValue(clock);
        vi.spyOn(Math, "random").mockReturnValue(random);
        expect(() => parseUsername(newAccount().username)).not.toThrow();
      }
    }
  });

  it("fills the 20 character limit, so two accounts differ unless made in the same millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_760_712_345_678);
    vi.spyOn(Math, "random").mockReturnValue(0.0042);

    expect(newAccount().username).toBe("riya_607123456780042");
  });

  it("no longer makes names like the one that failed: letters in the tag could spell a reserved word", () => {
    expect(() => parseUsername("riya_cp8um06316")).toThrow("That name is reserved");
  });
});
