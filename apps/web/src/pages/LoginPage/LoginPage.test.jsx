import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// CC-334, ADR-078 decision 2: a suspended account that logs in with the right password is told when it may come
// back and how to appeal, and nothing about reports. It can still download its data.

const ENDS = Date.UTC(2026, 9, 28, 6, 30); // 12:00 in India
const suspended = (details) =>
  new AppRequestError({
    code: "FORBIDDEN",
    message:
      "This account is paused for now. If you think this is a mistake, tell us through the feedback form",
    details: { reason: "suspended", ...details },
    status: 403,
  });

async function logIn(api) {
  const user = userEvent.setup();
  renderApp({ path: "/login", api });
  await user.type(await screen.findByLabelText("Email"), "bob@example.com");
  await user.type(screen.getByLabelText("Password"), "correct horse battery");
  await user.click(screen.getByRole("button", { name: "Log in" }));
  return user;
}

afterEach(() => vi.restoreAllMocks());

describe("LoginPage for a suspended account (CC-334)", () => {
  it("shows a suspended account the end date and the appeal line to the feedback form", async () => {
    const api = fakeApi({ login: vi.fn().mockRejectedValue(suspended({ endsAt: ENDS })) });
    const user = await logIn(api);

    const notice = await screen.findByRole("region", { name: "Your account is paused" });
    expect(notice).toHaveTextContent(/paused until 28 Oct 2026, 12:00 pm/i);
    expect(notice).toHaveTextContent("If you think this is a mistake, tell us through the feedback form.");
    expect(notice).not.toHaveTextContent(/report/i);
    // The generic failure under the button is not shown as well.
    expect(screen.queryByText(/This account is paused for now/)).toBeNull();

    await user.click(within(notice).getByRole("button", { name: "Tell us through the feedback form" }));

    expect(await screen.findByRole("dialog", { name: /Send us feedback/ })).toBeVisible();
  });

  it("says a suspension until lifted has no end date", async () => {
    await logIn(fakeApi({ login: vi.fn().mockRejectedValue(suspended({})) }));

    const notice = await screen.findByRole("region", { name: "Your account is paused" });
    expect(notice).toHaveTextContent("Your account is paused until the ClassiCade team lifts it.");
  });

  it("downloads a suspended account's data with the email and password it typed", async () => {
    const exportSuspendedData = vi
      .fn()
      .mockResolvedValue({ exportedAt: "2026-10-21T08:00:00.000Z", account: {} });
    const api = fakeApi({
      login: vi.fn().mockRejectedValue(suspended({ endsAt: ENDS })),
      exportSuspendedData,
    });
    const user = await logIn(api);
    const notice = await screen.findByRole("region", { name: "Your account is paused" });

    await user.click(within(notice).getByRole("button", { name: "Download my data" }));

    expect(exportSuspendedData).toHaveBeenCalledWith({
      email: "bob@example.com",
      password: "correct horse battery",
    });
    expect(await within(notice).findByText("Your data file is downloading.")).toBeVisible();
  });

  it("still shows the ordinary message for a wrong password", async () => {
    const wrong = new AppRequestError({
      code: "UNAUTHORIZED",
      message: "Invalid email or password",
      status: 401,
    });
    await logIn(fakeApi({ login: vi.fn().mockRejectedValue(wrong) }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(screen.queryByRole("region", { name: "Your account is paused" })).toBeNull();
  });
});
