import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const UNKNOWN = Object.freeze({ username: "Riya", createdAt: 0, ageGroup: "unknown" });
const profileApi = (overrides = {}) =>
  fakeApi({
    getSession: vi.fn(async () => USER),
    getMatches: async () => ({ matches: [] }),
    ...overrides,
  });
const wrongPassword = new AppRequestError({
  code: "VALIDATION_FAILED",
  message: "That is not your password",
  status: 400,
  details: { field: "password" },
});

async function openPrivacy(options) {
  const view = renderApp({ path: "/profile", ...options });
  return { ...view, privacy: await screen.findByRole("region", { name: "Your data and privacy" }) };
}

describe("year of birth on the profile (CC-152)", () => {
  it("lets an account without a year choose one once, and then shows it", async () => {
    const api = profileApi({
      setBirthYear: vi.fn(async (birthYear) => ({ ...UNKNOWN, birthYear, ageGroup: "adult" })),
    });
    const { privacy } = await openPrivacy({ api });
    expect(
      await within(privacy).findByText("On the public leaderboards your name shows as Hidden player."),
    ).toBeVisible();

    await userEvent.selectOptions(within(privacy).getByLabelText("Year of birth"), "1990");
    await userEvent.click(within(privacy).getByRole("button", { name: "Save year" }));

    expect(await within(privacy).findByText(/1990\. It can be set once/)).toBeInTheDocument();
    expect(api.setBirthYear).toHaveBeenCalledWith(1990);
    expect(within(privacy).queryByText(/Hidden player/)).toBeNull();
    expect(within(privacy).queryByLabelText("Year of birth")).toBeNull();
  });

  it("asks for a year before saving", async () => {
    const api = profileApi();
    const { privacy } = await openPrivacy({ api });

    await userEvent.click(await within(privacy).findByRole("button", { name: "Save year" }));

    expect((await within(privacy).findAllByText("Choose a year first")).length).toBeGreaterThan(0);
    expect(api.setBirthYear).not.toHaveBeenCalled();
  });

  it("keeps the refused year after an under 13 refusal", async () => {
    const tooYoung = new AppRequestError({
      code: "VALIDATION_FAILED",
      message: "ClassiCade accounts are for people aged 13 and over. You can keep playing as a guest.",
      status: 400,
      details: { field: "birthYear", reason: "too-young" },
    });
    const api = profileApi({ setBirthYear: vi.fn().mockRejectedValue(tooYoung) });
    const { privacy } = await openPrivacy({ api });
    const year = String(new Date().getFullYear() - 5);

    await userEvent.selectOptions(await within(privacy).findByLabelText("Year of birth"), year);
    await userEvent.click(within(privacy).getByRole("button", { name: "Save year" }));

    expect(await within(privacy).findByText(tooYoung.message)).toBeInTheDocument();
    expect(within(privacy).getByLabelText("Year of birth")).toBeDisabled();
  });

  it("shows a refusal that is not about the year under the button", async () => {
    const failure = new AppRequestError({ code: "CONFLICT", message: "Something else", status: 409 });
    const api = profileApi({ setBirthYear: vi.fn().mockRejectedValue(failure) });
    const { privacy } = await openPrivacy({ api });

    await userEvent.selectOptions(await within(privacy).findByLabelText("Year of birth"), "1990");
    await userEvent.click(within(privacy).getByRole("button", { name: "Save year" }));

    expect(await within(privacy).findByRole("alert")).toHaveTextContent("Something else");
  });

  it("says when the account could not be loaded", async () => {
    const failure = new AppRequestError({ code: "INTERNAL", message: "Internal server error", status: 500 });
    const { privacy } = await openPrivacy({
      api: profileApi({ getAccount: vi.fn().mockRejectedValue(failure) }),
    });

    expect(await within(privacy).findByRole("alert")).toHaveTextContent("Couldn't load your account.");
  });

  it("is not shown to a guest", async () => {
    renderApp({ path: "/profile", api: profileApi({ getSession: async () => GUEST }) });
    await screen.findByRole("region", { name: "Player console" });

    expect(screen.queryByRole("region", { name: "Your data and privacy" })).toBeNull();
  });
});

describe("downloading your data (CC-035)", () => {
  it("downloads the export as a dated JSON file after the password", async () => {
    const data = { exportedAt: "2026-10-18T10:00:00.000Z", account: { username: "Riya" } };
    const api = profileApi({ exportData: vi.fn(async () => data) });
    const { privacy, download } = await openPrivacy({ api });

    await userEvent.type(within(privacy).getByLabelText("Password for the download"), "my password");
    await userEvent.click(within(privacy).getByRole("button", { name: "Download my data" }));

    expect(await within(privacy).findByText("Your data is downloaded.")).toBeInTheDocument();
    expect(api.exportData).toHaveBeenCalledWith("my password");
    expect(download.saved).toEqual([{ filename: "classicade-data-2026-10-18.json", data }]);
    expect(within(privacy).getByLabelText("Password for the download")).toHaveValue("");
  });

  it("shows a wrong password at the password box and downloads nothing", async () => {
    const api = profileApi({ exportData: vi.fn().mockRejectedValue(wrongPassword) });
    const { privacy, download } = await openPrivacy({ api });

    await userEvent.type(within(privacy).getByLabelText("Password for the download"), "nope");
    await userEvent.click(within(privacy).getByRole("button", { name: "Download my data" }));

    expect(await within(privacy).findByText("That is not your password")).toBeInTheDocument();
    expect(within(privacy).getByLabelText("Password for the download")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(download.saved).toEqual([]);
  });
});

describe("deleting your account (CC-035)", () => {
  it("asks for the password first", async () => {
    const api = profileApi();
    const { privacy } = await openPrivacy({ api });

    await userEvent.click(within(privacy).getByRole("button", { name: "Delete my account" }));

    expect((await within(privacy).findAllByText("Type your password first")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says what goes and what stays, and keeps the account when told to", async () => {
    const api = profileApi();
    const { privacy } = await openPrivacy({ api });

    await userEvent.type(within(privacy).getByLabelText("Password for deleting"), "my password");
    await userEvent.click(within(privacy).getByRole("button", { name: "Delete my account" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete your account?" });

    expect(within(dialog).getByText(/replaced by "Deleted player"/)).toBeInTheDocument();
    expect(within(dialog).getByText(/backups are gone within 30 days/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Keep my account" })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep my account" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes the account, signs this browser out and says it is done", async () => {
    const api = profileApi();
    const { privacy, sessionBroadcast, url } = await openPrivacy({ api });

    await userEvent.type(within(privacy).getByLabelText("Password for deleting"), "my password");
    await userEvent.click(within(privacy).getByRole("button", { name: "Delete my account" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete for good" }));

    expect(await screen.findByText(/Your account and its data are deleted\./)).toHaveAttribute(
      "role",
      "status",
    );
    expect(api.deleteAccount).toHaveBeenCalledWith("my password");
    expect(sessionBroadcast.announce).toHaveBeenCalled();
    expect(url()).toBe("/profile");
    expect(screen.queryByRole("region", { name: "Your data and privacy" })).toBeNull();
    expect(screen.getByRole("link", { name: "log in" })).toBeInTheDocument();
  });

  it("closes the question and shows a wrong password at the password box", async () => {
    const api = profileApi({ deleteAccount: vi.fn().mockRejectedValue(wrongPassword) });
    const { privacy } = await openPrivacy({ api });

    await userEvent.type(within(privacy).getByLabelText("Password for deleting"), "nope");
    await userEvent.click(within(privacy).getByRole("button", { name: "Delete my account" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete for good" }));

    expect(await within(privacy).findByText("That is not your password")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: "Your data and privacy" })).toBeInTheDocument();
  });

  it("shows any other refusal in the question, under the button", async () => {
    const tooMany = new AppRequestError({
      code: "RATE_LIMITED",
      message: "Too many attempts, try again later",
      status: 429,
    });
    const api = profileApi({ deleteAccount: vi.fn().mockRejectedValue(tooMany) });
    const { privacy } = await openPrivacy({ api });

    await userEvent.type(within(privacy).getByLabelText("Password for deleting"), "pw");
    await userEvent.click(within(privacy).getByRole("button", { name: "Delete my account" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete for good" }));

    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Too many attempts, try again later");
  });
});
