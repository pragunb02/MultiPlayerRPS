import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesContext } from "../../app/servicesContext.js";
import { Modal } from "../../components/Modal/Modal.jsx";
import { ToastProvider } from "../../components/Toast/ToastProvider.jsx";
import { useToast } from "../../components/Toast/toastContext.js";
import { useInterruption } from "../../hooks/useInterruption.js";
import { useMatchPhase } from "../../hooks/useMatchPhase.js";
import { SessionContext } from "../../hooks/useSession.js";
import { fakeApi } from "../../testing/fakes.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { recordingTelemetry } from "../../testing/telemetry.js";
import { watchClicks } from "./clicks.js";
import { createInterruptionTracker } from "./interruptions.js";
import { InterruptionHost } from "./InterruptionHost.jsx";

let clock = 0;
const setup = ({ enabled = true } = {}) => {
  const telemetry = recordingTelemetry();
  const tracker = createInterruptionTracker({ telemetry, now: () => clock, strict: true });
  tracker.setEnabled(enabled);
  return { telemetry, tracker };
};

beforeEach(() => {
  clock = 0;
});

describe("how each interruption ended (CC-313)", () => {
  // AC-2 (CC-313)
  it("each way a surface ends is one event with its outcome", () => {
    const { telemetry, tracker } = setup();

    tracker.notePhase("waiting", "chess");
    const card = tracker.open("card.save_progress");
    clock = 2500;
    card.acted();
    card.end();

    const feedback = tracker.open("dialog.feedback");
    feedback.dismissed();
    clock = 2600;
    feedback.end();

    tracker.notePhase("my-turn", "chess");
    const xp = tracker.open("toast.xp");
    clock = 6600;
    xp.end("timed_out");

    tracker.notePhase(undefined);
    const connection = tracker.open("banner.connection");
    clock = 20_000;
    tracker.pageLeft();

    expect(telemetry.named("interruption_ended")).toEqual([
      {
        surface: "card.save_progress",
        kind: "card",
        class: "optional",
        blocking: false,
        outcome: "acted",
        shown_ms: "1-3s",
        phase: "before_play",
        trigger: "system",
        stack: "0",
      },
      {
        surface: "dialog.feedback",
        kind: "dialog",
        class: "optional",
        blocking: true,
        outcome: "dismissed",
        shown_ms: "0-1s",
        phase: "before_play",
        trigger: "player",
        stack: "0",
      },
      expect.objectContaining({
        surface: "toast.xp",
        outcome: "timed_out",
        shown_ms: "3-10s",
        phase: "playing",
      }),
      expect.objectContaining({
        surface: "banner.connection",
        outcome: "page_left",
        shown_ms: "10s+",
        phase: "elsewhere",
      }),
    ]);
    expect(connection).toBeDefined();
    // Ending twice is still one event.
    card.end();
    expect(telemetry.named("interruption_ended")).toHaveLength(4);
  });

  it("a dialog closed by its own button answered it, anything else without a mark went by itself", () => {
    const { telemetry, tracker } = setup();

    tracker.open("dialog.block").end();
    tracker.open("line.streak_at_risk").end();

    expect(telemetry.named("interruption_ended").map(({ outcome }) => outcome)).toEqual([
      "acted",
      "timed_out",
    ]);
  });

  // AC-3 (CC-313)
  it("a surface under another one is covered", async () => {
    vi.useFakeTimers();
    const telemetry = recordingTelemetry();
    const tracker = createInterruptionTracker({ telemetry, now: () => Date.now(), strict: true });
    tracker.setEnabled(true);
    let show;
    function Page() {
      const toast = useToast();
      const [open, setOpen] = [Page.open, Page.setOpen];
      show = toast.show;
      return (
        <Modal surface="dialog.feedback" open={open} title="Feedback" onClose={setOpen} actions={null}>
          Tell us
        </Modal>
      );
    }
    Page.open = false;
    Page.setOpen = () => {};
    const view = render(
      <ServicesContext.Provider value={{ interruptions: tracker }}>
        <ToastProvider displayMs={4000}>
          <Page />
        </ToastProvider>
      </ServicesContext.Provider>,
    );

    act(() => show("+30 XP", { surface: "toast.xp" }));
    Page.open = true;
    view.rerender(
      <ServicesContext.Provider value={{ interruptions: tracker }}>
        <ToastProvider displayMs={4000}>
          <Page />
        </ToastProvider>
      </ServicesContext.Provider>,
    );
    await act(async () => vi.advanceTimersByTime(4000));
    vi.useRealTimers();

    const [toastEnded] = telemetry.named("interruption_ended");
    expect(toastEnded).toMatchObject({ surface: "toast.xp", outcome: "covered", stack: "0" });
    expect(tracker.showing()).toEqual(["dialog.feedback"]);
    tracker.pageLeft();
    expect(telemetry.named("interruption_ended")[1]).toMatchObject({
      surface: "dialog.feedback",
      stack: "1",
    });
  });

  it("a toast's link acts on it, its close button dismisses it, and a waiting toast is not counted", async () => {
    const telemetry = recordingTelemetry();
    const tracker = createInterruptionTracker({ telemetry, now: () => 0 });
    tracker.setEnabled(true);
    let toast;
    function Grab() {
      toast = useToast();
      return null;
    }
    render(
      <MemoryRouter>
        <ServicesContext.Provider value={{ interruptions: tracker }}>
          <ToastProvider displayMs={30}>
            <Grab />
          </ToastProvider>
        </ServicesContext.Provider>
      </MemoryRouter>,
    );
    const action = { label: "Save it", to: "/signup", dismissLabel: "Close", onDismiss: () => {} };
    const user = userEvent.setup();

    act(() => toast.show("Saved", { surface: "toast.saved", action }));
    await user.click(screen.getByRole("link", { name: "Save it" }));
    // Counting changes nothing on screen: the toast stays for its time, as it always did (review of #162).
    expect(screen.getByRole("link", { name: "Save it" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("link", { name: "Save it" })).not.toBeInTheDocument());
    act(() => toast.show("Saved again", { surface: "toast.saved", action }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    let release;
    act(() => {
      release = toast.hold("request");
      toast.dismiss(toast.show("+30 XP", { surface: "toast.xp", category: "reward" }));
      release();
    });

    expect(telemetry.named("interruption_ended").map(({ outcome }) => outcome)).toEqual([
      "acted",
      "dismissed",
    ]);
    expect(() => toast.show("No surface")).toThrow(/Unknown surface/);
  });

  it("a dialog closed with Escape or the backdrop was dismissed", async () => {
    const { telemetry, tracker } = setup();
    function Dialog() {
      const [open, setOpen] = [true, () => {}];
      return (
        <Modal
          surface="dialog.sound"
          open={open}
          title="Sound"
          onClose={setOpen}
          actions={<button>OK</button>}
        >
          x
        </Modal>
      );
    }
    const view = render(
      <ServicesContext.Provider value={{ interruptions: tracker }}>
        <Dialog />
      </ServicesContext.Provider>,
    );
    const user = userEvent.setup();

    await user.keyboard("{Escape}");
    view.unmount();

    expect(telemetry.named("interruption_ended").map(({ outcome }) => outcome)).toEqual(["dismissed"]);
  });
});

describe("the phase a surface opens in (review of #162)", () => {
  it("a card that opens with the result counts in the result, not during play", () => {
    const { telemetry, tracker } = setup();
    function Card() {
      useInterruption("card.save_progress");
      return null;
    }
    function Shell({ phase }) {
      useMatchPhase(phase, "tictactoe");
      return phase === "finished" ? <Card /> : null;
    }
    const tree = (phase) => (
      <ServicesContext.Provider value={{ interruptions: tracker, telemetry }}>
        <Shell phase={phase} />
      </ServicesContext.Provider>
    );
    const view = render(tree("my-turn"));
    view.rerender(tree("finished"));
    view.unmount();

    expect(telemetry.named("interruption_ended")).toEqual([
      expect.objectContaining({ surface: "card.save_progress", phase: "result" }),
    ]);
  });
});

describe("counts per visit and per game (CC-313)", () => {
  // AC-4 (CC-313)
  it("counts per visit and per game", () => {
    const { telemetry, tracker } = setup();

    tracker.open("card.save_progress").end();
    tracker.notePhase("waiting", "rps");
    tracker.notePhase("my-turn", "rps");
    tracker.open("request.site").end();
    tracker.open("banner.request").end();
    tracker.open("dialog.feedback").end();
    tracker.notePhase("their-turn", "rps");
    tracker.notePhase("finished", "rps");
    tracker.pageLeft();

    expect(telemetry.named("interruption_counted")).toEqual([
      { scope: "game", game_id: "rps", optional: "1", blocking_optional: "0", essential: "1" },
      { scope: "visit", optional: "2", blocking_optional: "0", essential: "1" },
    ]);
  });

  it("a game seen only from its result, or watched, is not counted, and a new game starts its own count", () => {
    const { telemetry, tracker } = setup();

    tracker.notePhase("finished", "chess");
    tracker.notePhase("watching", "chess");
    tracker.notePhase("my-turn", "chess");
    tracker.open("toast.xp").end();
    tracker.notePhase("finished", "chess");
    tracker.notePhase("my-turn", "chess");
    tracker.notePhase("finished", "chess");

    expect(telemetry.named("interruption_counted")).toEqual([
      { scope: "game", game_id: "chess", optional: "1", blocking_optional: "0", essential: "0" },
      { scope: "game", game_id: "chess", optional: "0", blocking_optional: "0", essential: "0" },
    ]);
  });

  // AC-8 (CC-313)
  it("first move and click events name the interruptions", async () => {
    const { tracker } = setup();
    expect(tracker.interruptionsBefore()).toBe("0");
    tracker.open("toast.xp").end();
    tracker.open("card.save_progress").end();
    tracker.open("toast.copied").end();
    expect(tracker.interruptionsBefore()).toBe("2");
    tracker.open("toast.achievement").end();
    tracker.open("toast.quest").end();
    expect(tracker.interruptionsBefore()).toBe("3+");

    vi.useFakeTimers();
    document.body.innerHTML = `<main><div data-cc-surface="toast.xp"><img alt=""></div>
      <div data-cc-surface="made.up"><img id="other" alt=""></div></main>`;
    const tracked = [];
    const watcher = watchClicks({
      document,
      view: window,
      track: (name, fields) => tracked.push([name, fields]),
      requestsSent: () => ({ http: 0, socket: 0 }),
      MutationObserver: window.MutationObserver,
      now: () => Date.now(),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer),
      surfaceOf: tracker.surfaceOf,
    });
    const press = (element, x = 0) =>
      element.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: x }));
    const img = document.querySelector("img");
    press(img);
    press(img);
    press(img);
    press(document.getElementById("other"), 500);
    await vi.advanceTimersByTimeAsync(1000);
    watcher.stop();
    vi.useRealTimers();
    document.body.innerHTML = "";

    expect(tracked.find(([name]) => name === "rage_clicked")[1]).toEqual({
      element: "img",
      surface: "toast.xp",
      presses: "3",
    });
    expect(tracked.filter(([name]) => name === "dead_clicked").map(([, fields]) => fields)).toContainEqual({
      element: "img",
      surface: "toast.xp",
    });
    expect(tracked.filter(([, fields]) => fields.surface === "made.up")).toEqual([]);
  });
});

describe("the host's other duties (CC-313)", () => {
  it("reaches a challenge's step, ends what shows when the page is left, and names no surface while off", async () => {
    const telemetry = recordingTelemetry();
    const tracker = createInterruptionTracker({ telemetry, now: () => 0 });
    const api = fakeApi({ getFlags: vi.fn(async () => ({ interruption_counts: true })) });
    telemetry.setLanding({ entry: "room_link", via: "" });
    expect(tracker.surfaceOf(document.body)).toBeUndefined();
    const view = render(
      <MemoryRouter initialEntries={["/challenge/c7Q2xY9kLm3NpR8s"]}>
        <ServicesContext.Provider value={{ api, telemetry, interruptions: tracker }}>
          <SessionContext.Provider value={{ status: "anonymous", identity: undefined }}>
            <InterruptionHost />
          </SessionContext.Provider>
        </ServicesContext.Provider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(tracker.isEnabled()).toBe(true));
    const banner = tracker.open("banner.connection");
    banner.timedOut();

    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    expect(telemetry.named("interruption_ended")).toEqual([]);
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    view.unmount();

    expect(telemetry.named("funnel_step_reached")).toEqual([
      { funnel: "visit_to_play", step: "landed" },
      { funnel: "link_to_seat", step: "link_opened" },
      { funnel: "challenge", step: "challenge_opened" },
    ]);
    expect(telemetry.named("interruption_ended")).toEqual([
      expect.objectContaining({ surface: "banner.connection", outcome: "page_left" }),
    ]);
    expect(telemetry.named("interruption_counted")).toEqual([
      { scope: "visit", optional: "0", blocking_optional: "0", essential: "1" },
    ]);
  });

  it("a screen that is no funnel step reaches none, and a game's page reaches game_opened", async () => {
    const telemetry = recordingTelemetry();
    const tracker = createInterruptionTracker({ telemetry, now: () => 0 });
    const api = fakeApi({ getFlags: vi.fn(async () => ({ interruption_counts: true })) });
    const host = (path) => (
      <MemoryRouter initialEntries={[path]}>
        <ServicesContext.Provider value={{ api, telemetry, interruptions: tracker }}>
          <SessionContext.Provider value={{ status: "anonymous", identity: undefined }}>
            <InterruptionHost />
          </SessionContext.Provider>
        </ServicesContext.Provider>
      </MemoryRouter>
    );
    const first = render(host("/leaderboards/weekly"));
    await waitFor(() => expect(tracker.isEnabled()).toBe(true));
    first.unmount();
    render(host("/games/chess"));
    await waitFor(() => expect(telemetry.named("funnel_step_reached")).toHaveLength(2));

    expect(telemetry.named("funnel_step_reached").map(({ step }) => step)).toEqual(["landed", "game_opened"]);
  });
});

describe("the interruption_counts flag (CC-313)", () => {
  afterEach(() => vi.useRealTimers());

  // AC-13 (CC-313)
  flagPaths("interruption_counts", (on) => {
    it(on ? "sends interruption events" : "sends no interruption event", async () => {
      const telemetry = recordingTelemetry();
      const tracker = createInterruptionTracker({ telemetry, now: () => 0 });
      const api = fakeApi({ getFlags: vi.fn(async () => ({ interruption_counts: on })) });
      function Banner() {
        useInterruption("banner.connection");
        return <main>Reconnecting</main>;
      }
      const view = render(
        <MemoryRouter initialEntries={["/signup"]}>
          <ServicesContext.Provider value={{ api, telemetry, interruptions: tracker }}>
            <SessionContext.Provider value={{ status: "anonymous", identity: undefined }}>
              <InterruptionHost />
            </SessionContext.Provider>
          </ServicesContext.Provider>
        </MemoryRouter>,
      );
      await waitFor(() => expect(api.getFlags).toHaveBeenCalledWith(["interruption_counts"]));
      await waitFor(() => expect(tracker.isEnabled()).toBe(on));
      view.rerender(
        <MemoryRouter initialEntries={["/signup"]}>
          <ServicesContext.Provider value={{ api, telemetry, interruptions: tracker }}>
            <SessionContext.Provider value={{ status: "anonymous", identity: undefined }}>
              <InterruptionHost />
              <Banner />
            </SessionContext.Provider>
          </ServicesContext.Provider>
        </MemoryRouter>,
      );
      view.unmount();

      const names = telemetry.tracked.map(([name]) => name);
      if (on) {
        expect(names).toContain("interruption_ended");
        expect(telemetry.named("funnel_step_reached")).toEqual([
          { funnel: "visit_to_play", step: "landed" },
          { funnel: "sign_up", step: "form_viewed" },
        ]);
        // The flag's success is told only when the server took a batch with an interruption (flagSuccess.test.js).
        expect(api.sendFlagSuccess).not.toHaveBeenCalled();
      } else {
        expect(names).toEqual([]);
        expect(api.sendFlagSuccess).not.toHaveBeenCalled();
      }
    });
  });
});
