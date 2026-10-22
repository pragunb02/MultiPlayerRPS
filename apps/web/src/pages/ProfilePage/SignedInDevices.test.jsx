import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";
import { deviceName } from "./deviceName.js";

// CC-262: the account's signed-in devices, under Devices on the profile, with Sign out on each other one.
const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const device = (id, fields) => ({
  id: id.padEnd(22, "A"),
  signedInDay: "2026-10-01",
  lastSeenDay: "2026-10-20",
  current: false,
  ...fields,
});
const LAPTOP = device("laptop", {
  browser: "Firefox",
  system: "Windows",
  lastSeenDay: "2026-10-21",
  current: true,
});
const PHONE = device("phone", { browser: "Chrome", system: "Android" });
const TABLET = device("tablet", { browser: "Safari", system: "iPad", lastSeenDay: "2026-10-19" });

const profileApi = (overrides = {}) =>
  fakeApi({
    getSession: async () => USER,
    getMatches: async () => ({ matches: [] }),
    getDevices: vi.fn().mockResolvedValue([LAPTOP, PHONE, TABLET]),
    ...overrides,
  });

async function openDevices(api) {
  renderApp({ path: "/profile", api });
  const account = await screen.findByRole("region", { name: "Account" });
  return { account, list: await within(account).findByRole("list", { name: "Signed-in devices" }) };
}

describe("signed-in devices on the profile (CC-262)", () => {
  it("lists every device with its days, marks this one and offers Sign out on the others only", async () => {
    const { list } = await openDevices(profileApi());

    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Firefox on Windows");
    expect(rows[0]).toHaveTextContent("This device");
    expect(rows[0]).toHaveTextContent("Signed in 1 Oct 2026");
    expect(rows[0]).toHaveTextContent("Last seen 21 Oct 2026");
    expect(within(rows[0]).queryByRole("button")).toBeNull();
    expect(
      within(rows[1]).getByRole("button", { name: "Sign out Chrome on Android, last seen 20 Oct 2026" }),
    ).toBeVisible();
    expect(
      within(rows[2]).getByRole("button", { name: "Sign out Safari on iPad, last seen 19 Oct 2026" }),
    ).toBeVisible();
    expect(rows[1]).not.toHaveTextContent("This device");
  });

  it("signs one device out, says so and moves the focus to the next device's button", async () => {
    const api = profileApi();
    const { account, list } = await openDevices(api);

    await userEvent.click(within(list).getByRole("button", { name: /^Sign out Chrome on Android/ }));

    expect(await within(account).findByRole("status")).toHaveTextContent("Chrome on Android is signed out.");
    expect(api.signOutDevice).toHaveBeenCalledWith(PHONE.id);
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).queryByText("Chrome on Android")).toBeNull();
    expect(within(list).getByRole("button", { name: /^Sign out Safari on iPad/ })).toHaveFocus();
  });

  it("moves the focus to the previous device's button when the last one goes", async () => {
    const { list } = await openDevices(profileApi());

    await userEvent.click(within(list).getByRole("button", { name: /^Sign out Safari on iPad/ }));

    await vi.waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    expect(within(list).getByRole("button", { name: /^Sign out Chrome on Android/ })).toHaveFocus();
  });

  it("moves the focus to the message when no other device is left", async () => {
    const { account, list } = await openDevices(
      profileApi({ getDevices: vi.fn().mockResolvedValue([LAPTOP, PHONE]) }),
    );

    await userEvent.click(within(list).getByRole("button", { name: /^Sign out Chrome on Android/ }));

    expect(await within(account).findByRole("status")).toHaveFocus();
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps the device and says why when signing it out fails", async () => {
    const gone = new AppRequestError({
      code: "NOT_FOUND",
      message: "That device is not signed in",
      status: 404,
    });
    const { list } = await openDevices(profileApi({ signOutDevice: vi.fn().mockRejectedValue(gone) }));

    await userEvent.click(within(list).getByRole("button", { name: /^Sign out Chrome on Android/ }));

    expect(await within(list).findByRole("alert")).toHaveTextContent("That device is not signed in");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });

  it("lists only this device again after signing out the others", async () => {
    const getDevices = vi.fn().mockResolvedValueOnce([LAPTOP, PHONE, TABLET]).mockResolvedValue([LAPTOP]);
    const { account, list } = await openDevices(profileApi({ getDevices }));

    await userEvent.click(within(account).getByRole("button", { name: "Sign out other devices" }));

    await vi.waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(1));
    expect(within(list).getByRole("listitem")).toHaveTextContent("This device");
  });

  it("shows loading, then a failure to load", async () => {
    // The answer is made before the page asks for it, so the test can refuse it whenever the page asks.
    let fail = () => {};
    const answer = new Promise((_, reject) => {
      fail = reject;
    });
    const getDevices = vi.fn(() => answer);
    renderApp({ path: "/profile", api: profileApi({ getDevices }) });
    const account = await screen.findByRole("region", { name: "Account" });

    expect(within(account).getByText("Loading your devices…")).toBeVisible();
    await vi.waitFor(() => expect(getDevices).toHaveBeenCalled());
    fail(new AppRequestError({ code: "UNKNOWN", message: "Something went wrong", status: 500 }));

    expect(await within(account).findByRole("alert")).toHaveTextContent(
      "Couldn't load your devices. Something went wrong",
    );
  });
});

describe("deviceName (CC-262)", () => {
  it.each([
    ["Chrome", "Android", "Chrome on Android"],
    ["Unknown", "Android", "A browser on Android"],
    ["Chrome", "Unknown", "Chrome"],
    ["Unknown", "Unknown", "Unknown device"],
  ])("names %s on %s as %s", (browser, system, name) => {
    expect(deviceName({ browser, system })).toBe(name);
  });
});
