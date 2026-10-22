import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const profileApi = (identity, overrides = {}) =>
  fakeApi({ getSession: async () => identity, getMatches: async () => ({ matches: [] }), ...overrides });

async function openAccount(api) {
  renderApp({ path: "/profile", api });
  return screen.findByRole("region", { name: "Account" });
}

const fieldError = (message, field, reason) =>
  new AppRequestError({
    code: "VALIDATION_FAILED",
    message,
    status: 400,
    details: { field, reason },
  });

describe("account settings on the profile (CC-116)", () => {
  it("changes the password, clears the form and says the other devices are signed out", async () => {
    const api = profileApi(USER);
    const account = await openAccount(api);

    await userEvent.type(within(account).getByLabelText("Current password"), "old password 1");
    await userEvent.type(within(account).getByLabelText("New password"), "new password 1");
    await userEvent.click(within(account).getByRole("button", { name: "Change password" }));

    expect(await within(account).findByRole("status")).toHaveTextContent(
      "Password changed. Your other devices are signed out.",
    );
    expect(api.changePassword).toHaveBeenCalledWith({
      currentPassword: "old password 1",
      newPassword: "new password 1",
    });
    expect(within(account).getByLabelText("Current password")).toHaveValue("");
    expect(within(account).getByLabelText("New password")).toHaveValue("");
  });

  it.each([
    [
      "Current password",
      "currentPassword",
      "That is not your current password",
      "That isn't your current password. Check it and try again.",
      "wrong-current-password",
    ],
    [
      "New password",
      "newPassword",
      "Passwords are 8–128 characters",
      "A password needs 8 to 128 characters. Change its length and try again.",
      "password-length",
    ],
    [
      "New password",
      "newPassword",
      "Passwords cannot be only spaces",
      "A password can't be only spaces. Add letters or numbers.",
      "password-only-spaces",
    ],
    [
      "New password",
      "newPassword",
      "That password is too easy to guess. Choose a different one.",
      "That password is too easy to guess. Try a longer phrase only you would know.",
      "easy-password",
    ],
    [
      "New password",
      "newPassword",
      "Choose a password different from your current one",
      "That's your current password. Choose a new one.",
      "same-as-current",
    ],
  ])(
    "shows a refusal of the %s next to that box, in plain words",
    async (label, field, message, words, reason) => {
      const api = profileApi(USER, {
        changePassword: vi.fn().mockRejectedValue(fieldError(message, field, reason)),
      });
      const account = await openAccount(api);

      await userEvent.click(within(account).getByRole("button", { name: "Change password" }));

      const input = within(account).getByLabelText(label);
      await vi.waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
      expect(within(account).getByText(words)).toBeInTheDocument();
      expect(within(account).queryByText(message)).toBeNull();
      expect(within(account).queryByRole("alert")).toBeNull();
    },
  );

  it("shows any other refusal for the whole form", async () => {
    const tooMany = new AppRequestError({
      code: "RATE_LIMITED",
      message: "Too many attempts, try again later",
      status: 429,
    });
    const account = await openAccount(
      profileApi(USER, { changePassword: vi.fn().mockRejectedValue(tooMany) }),
    );

    await userEvent.click(within(account).getByRole("button", { name: "Change password" }));

    expect(await within(account).findByRole("alert")).toHaveTextContent(
      "Too many tries in a row. Wait a minute, then try again.",
    );
  });

  it("signs out the other devices and says so", async () => {
    const api = profileApi(USER);
    const account = await openAccount(api);

    await userEvent.click(within(account).getByRole("button", { name: "Sign out other devices" }));

    expect(await within(account).findByRole("status")).toHaveTextContent(
      "Your other devices are signed out.",
    );
    expect(api.signOutOtherDevices).toHaveBeenCalledOnce();
  });

  it("explains when signing out the other devices failed", async () => {
    const failure = new AppRequestError({ code: "INTERNAL", message: "Internal server error", status: 500 });
    const account = await openAccount(
      profileApi(USER, { signOutOtherDevices: vi.fn().mockRejectedValue(failure) }),
    );

    await userEvent.click(within(account).getByRole("button", { name: "Sign out other devices" }));

    expect(await within(account).findByRole("alert")).toHaveTextContent(
      "That didn't work on our side. Try again in a moment.",
    );
  });

  it("is not shown to a guest, who has no password", async () => {
    renderApp({ path: "/profile", api: profileApi(GUEST) });
    await screen.findByRole("region", { name: "Player console" });

    expect(screen.queryByRole("region", { name: "Account" })).toBeNull();
  });
});
