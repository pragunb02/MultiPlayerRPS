import { describe, expect, it } from "vitest";
import { ValidationError } from "../../utils/errors.js";
import { createPasswordScreen, EASY_PASSWORD } from "./passwordScreen.js";

/** A fake of the breached password accessor: the common and breached passwords it knows, or a failing service. */
function fakeBreaches({ common = [], breached = [], failure } = {}) {
  const asked = [];
  return {
    asked,
    accessor: {
      isCommon: (password) => common.includes(password.toLowerCase()),
      isBreached: async (password) => {
        asked.push(password);
        if (failure !== undefined) throw failure;
        return breached.includes(password);
      },
    },
  };
}

function setup(sources) {
  const outcomes = [];
  const { accessor, asked } = fakeBreaches(sources);
  const screen = createPasswordScreen({
    breachedPasswords: accessor,
    recordCheck: ({ outcome }) => outcomes.push(outcome),
  });
  return { screen, outcomes, asked };
}

describe("passwordScreen", () => {
  it("lets a password through that neither source knows, and counts it as clear", async () => {
    const { screen, outcomes } = setup();

    await expect(
      screen.check({ password: "correct horse battery", field: "password" }),
    ).resolves.toBeUndefined();
    expect(outcomes).toEqual(["clear"]);
  });

  it("refuses a common password at its field, without asking the breach service", async () => {
    const { screen, outcomes, asked } = setup({ common: ["password1"] });

    const refused = screen.check({ password: "Password1", field: "newPassword" });

    await expect(refused).rejects.toThrow(ValidationError);
    await expect(refused).rejects.toMatchObject({
      message: EASY_PASSWORD,
      details: { field: "newPassword" },
    });
    expect(asked).toEqual([]);
    expect(outcomes).toEqual(["common"]);
  });

  it("refuses a breached password with the same words", async () => {
    const { screen, outcomes } = setup({ breached: ["not-a-real-secret-phrase"] });

    await expect(
      screen.check({ password: "not-a-real-secret-phrase", field: "password" }),
    ).rejects.toMatchObject({
      message: EASY_PASSWORD,
      details: { field: "password" },
    });
    expect(outcomes).toEqual(["breached"]);
  });

  it("lets the password through when the breach service fails, after the local check, and counts it", async () => {
    const { screen, outcomes, asked } = setup({ failure: new Error("timed out") });

    await expect(
      screen.check({ password: "correct horse battery", field: "password" }),
    ).resolves.toBeUndefined();
    expect(asked).toEqual(["correct horse battery"]);
    expect(outcomes).toEqual(["unavailable"]);
  });

  it("still refuses a common password when the breach service is down", async () => {
    const { screen, outcomes } = setup({ common: ["qwertyuiop"], failure: new Error("down") });

    await expect(screen.check({ password: "qwertyuiop", field: "password" })).rejects.toThrow(EASY_PASSWORD);
    expect(outcomes).toEqual(["common"]);
  });

  it("says plainly what to do, and nothing about where the password was found", () => {
    expect(EASY_PASSWORD).toBe("That password is too easy to guess. Choose a different one.");
    expect(EASY_PASSWORD).not.toMatch(/pwned|breach|leak|haveibeenpwned|list/i);
  });

  it("counts nothing when no counter is given", async () => {
    const { accessor } = fakeBreaches();

    await expect(
      createPasswordScreen({ breachedPasswords: accessor }).check({
        password: "fine password",
        field: "password",
      }),
    ).resolves.toBeUndefined();
  });

  it("needs the breached password accessor", () => {
    expect(() => createPasswordScreen({})).toThrow(TypeError);
  });
});
