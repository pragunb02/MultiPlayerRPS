import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// CC-152: the owner corrects a player's year of birth on request, from the console.

const OWNER = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Site_Owner" };
const PLAYER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };

const ownerApi = (overrides = {}) =>
  fakeApi({
    getSession: async () => OWNER,
    getAdminStatus: vi.fn().mockResolvedValue(true),
    ...overrides,
  });

async function openAges(api = ownerApi()) {
  renderApp({ path: "/admin/ages", api });
  await screen.findByRole("heading", { name: "Birth year corrections" });
  return userEvent.setup();
}

afterEach(() => vi.restoreAllMocks());

describe("year of birth corrections in the owner console (CC-152)", () => {
  it.each([
    ["a visitor", fakeApi()],
    ["a guest", fakeApi({ getSession: async () => GUEST })],
    ["an account that is not an admin", fakeApi({ getSession: async () => PLAYER })],
  ])("shows %s the ordinary not found page", async (_, api) => {
    renderApp({ path: "/admin/ages", api });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  it("is a tab of the console", async () => {
    await openAges();

    expect(screen.getByRole("link", { name: "Ages" })).toHaveAttribute("aria-current", "page");
  });

  it("sends the email and the year, and shows what the account is now", async () => {
    const api = ownerApi({
      correctBirthYear: vi.fn().mockResolvedValue({ username: "sam", birthYear: 2010, ageGroup: "minor" }),
    });
    const user = await openAges(api);

    await user.type(screen.getByLabelText("Account email"), "sam@example.com");
    await user.selectOptions(screen.getByLabelText("Year of birth"), "2010");
    await user.click(screen.getByRole("button", { name: "Correct the year" }));

    expect(api.correctBirthYear).toHaveBeenCalledWith({ email: "sam@example.com", birthYear: 2010 });
    expect(await screen.findByText("sam: year of birth 2010, so minor.")).toBeVisible();
  });

  it("clears the year when none is chosen, so the account is of unknown age again", async () => {
    const api = ownerApi({
      correctBirthYear: vi.fn().mockResolvedValue({ username: "sam", ageGroup: "unknown" }),
    });
    const user = await openAges(api);

    await user.type(screen.getByLabelText("Account email"), "sam@example.com");
    await user.click(screen.getByRole("button", { name: "Clear the year" }));

    expect(api.correctBirthYear).toHaveBeenCalledWith({ email: "sam@example.com", birthYear: null });
    expect(await screen.findByText("sam: no year of birth, so unknown.")).toBeVisible();
  });

  it("asks for an email and a year before correcting, and shows the server's refusal", async () => {
    const refusal = new AppRequestError({
      code: "NOT_FOUND",
      message: "No account has that email",
      status: 404,
    });
    const api = ownerApi({ correctBirthYear: vi.fn().mockRejectedValue(refusal) });
    const user = await openAges(api);

    await user.click(screen.getByRole("button", { name: "Correct the year" }));
    // Enter in the email box sends nothing either: only a button corrects or clears.
    await user.type(screen.getByLabelText("Account email"), "x{Enter}");
    await user.clear(screen.getByLabelText("Account email"));
    expect(api.correctBirthYear).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Account email"), "nobody@example.com");
    await user.selectOptions(screen.getByLabelText("Year of birth"), "1990");
    await user.click(screen.getByRole("button", { name: "Correct the year" }));

    expect(await screen.findByText("No account has that email")).toBeVisible();
  });
});
