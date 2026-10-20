import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesContext } from "../../app/servicesContext.js";
import { useAction } from "../../hooks/useAction.js";
import { AppRequestError } from "../errors.js";
import { fakeApi } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";
import { recordingTelemetry } from "../../testing/telemetry.js";
import { TELEMETRY_STORAGE_KEY } from "./optOut.js";

// How the app tells usage counts what happened (CC-174): pages, the auth forms, presses that waited, the switch.
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("page views (CC-174)", () => {
  it("counts the landing once with how it arrived, then each new page, at its canonical address", async () => {
    const telemetry = recordingTelemetry();
    telemetry.setLanding({ entry: "shared_link", via: "wa" });
    const user = userEvent.setup();
    renderApp({ path: "/play/chess", telemetry });

    await waitFor(() => expect(telemetry.named("page_viewed")).toHaveLength(1));
    expect(telemetry.named("page_viewed")).toEqual([{ is_landing: true, entry: "shared_link", via: "wa" }]);
    expect(telemetry.context()).toEqual({ route: "/games/chess", playerKind: "visitor" });

    await user.click(screen.getAllByRole("link", { name: /ClassiCade|Home/ })[0]);
    await waitFor(() => expect(telemetry.named("page_viewed")).toHaveLength(2));
    expect(telemetry.named("page_viewed")[1]).toEqual({ is_landing: false });
    expect(telemetry.context().route).toBe("/");
  });
});

describe("the auth forms (CC-174, EVENTS.md 3.3)", () => {
  it("counts the login form's view and submit, with where next points as a kind", async () => {
    const telemetry = recordingTelemetry();
    const user = userEvent.setup();
    renderApp({
      path: "/login?next=/profile",
      telemetry,
      api: fakeApi({ login: vi.fn(() => new Promise(() => {})) }),
    });

    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(telemetry.named("auth_form_viewed")).toEqual([{ form: "login", next_kind: "profile" }]);
    expect(telemetry.named("auth_form_submitted")).toEqual([{ form: "login" }]);
    expect(JSON.stringify(telemetry.tracked)).not.toContain("riya");
  });

  it("counts which sign-up fields stopped the form and why, then the submit, never what was typed", async () => {
    const telemetry = recordingTelemetry();
    const user = userEvent.setup();
    renderApp({ path: "/signup", telemetry, api: fakeApi({ signup: vi.fn(() => new Promise(() => {})) }) });

    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(telemetry.named("auth_form_rejected")).toEqual([
      { form: "signup", field: "username", rule: "missing" },
      { form: "signup", field: "email", rule: "missing" },
      { form: "signup", field: "password", rule: "too_short" },
    ]);
    expect(telemetry.named("auth_form_submitted")).toEqual([]);

    await user.type(screen.getByLabelText("Username"), "riya_plays");
    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), " and longer");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(telemetry.named("auth_form_viewed")).toEqual([{ form: "signup", next_kind: "none" }]);
    expect(telemetry.named("auth_form_submitted")).toEqual([{ form: "signup" }]);
    expect(JSON.stringify(telemetry.tracked)).not.toMatch(/riya|example/);
  });
});

describe("presses that waited (CC-174, CC-240's browser slice)", () => {
  function Press({ work, id = "room.rematch.ask" }) {
    const action = useAction(work, { id });
    return (
      <button type="button" onClick={() => action.run()}>
        Press
      </button>
    );
  }
  const renderPress = (telemetry, work) =>
    render(
      <ServicesContext.Provider value={{ telemetry }}>
        <Press work={work} />
      </ServicesContext.Provider>,
    );

  it("counts how long a press waited, over the transport it used, and how it ended", async () => {
    const telemetry = recordingTelemetry();
    const user = userEvent.setup();
    let fail = false;
    renderPress(telemetry, async () => {
      telemetry.noteRequest(fail ? "http" : "socket");
      if (fail) throw new AppRequestError({ code: "CONFLICT", message: "Riya already asked", status: 409 });
    });

    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(telemetry.named("action_waited")).toHaveLength(1));
    fail = true;
    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(telemetry.named("action_waited")).toHaveLength(2));

    const [ok, refused] = telemetry.named("action_waited");
    expect(ok).toMatchObject({
      control: "room.rematch.ask",
      transport: "socket",
      outcome: "ok",
      showed_spinner: false,
    });
    expect(refused).toMatchObject({ transport: "http", outcome: "CONFLICT" });
    expect(ok.wait_ms % 10).toBe(0);
  });

  it("counts nothing for a press that sent nothing, and nothing goes wrong without telemetry", async () => {
    const telemetry = recordingTelemetry();
    const user = userEvent.setup();
    renderPress(telemetry, async () => undefined);
    await user.click(screen.getByRole("button"));
    expect(telemetry.named("action_waited")).toEqual([]);

    render(<Press work={async () => undefined} />);
    await user.click(screen.getAllByRole("button")[1]);
  });

  it("a control name the catalogue refuses never changes how the press ends", async () => {
    const telemetry = {
      ...recordingTelemetry(),
      track: () => {
        throw new RangeError("refused");
      },
    };
    const work = vi.fn(async () => telemetry.noteRequest("http"));
    render(
      <ServicesContext.Provider value={{ telemetry }}>
        <Press work={work} id="Not.A.Name" />
      </ServicesContext.Provider>,
    );

    await act(async () => screen.getByRole("button").click());
    expect(work).toHaveBeenCalledOnce();
  });
});

describe("the usage counts switch (CC-174, ADR-034.3)", () => {
  it("turns counts off in this browser and back on, and says why it is off with GPC", async () => {
    const telemetry = recordingTelemetry();
    const switched = vi.spyOn(telemetry, "switched");
    const user = userEvent.setup();
    const { unmount } = renderApp({ path: "/privacy", telemetry });

    const box = screen.getByRole("checkbox", { name: "Count how I use the site, anonymously" });
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(window.localStorage.getItem(TELEMETRY_STORAGE_KEY)).toBe("off");
    await user.click(box);
    expect(window.localStorage.getItem(TELEMETRY_STORAGE_KEY)).toBeNull();
    expect(switched).toHaveBeenCalledTimes(2);
    unmount();

    vi.stubGlobal("navigator", { ...navigator, globalPrivacyControl: true });
    renderApp({ path: "/privacy", telemetry });
    const blocked = screen.getByRole("checkbox", { name: "Count how I use the site, anonymously" });
    expect(blocked).toBeDisabled();
    expect(blocked).not.toBeChecked();
    expect(blocked).toHaveAccessibleDescription(/Your browser asks sites not to track you/);
  });
});
