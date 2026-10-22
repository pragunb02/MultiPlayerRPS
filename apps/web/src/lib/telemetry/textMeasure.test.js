import { act, render } from "@testing-library/react";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesContext } from "../../app/servicesContext.js";
import { SessionContext } from "../../hooks/useSession.js";
import { fakeApi } from "../../testing/fakes.js";
import { recordingTelemetry } from "../../testing/telemetry.js";
import { createInterruptionTracker } from "./interruptions.js";
import { InterruptionHost, TEXT_AFTER_MS } from "./InterruptionHost.jsx";
import { countWords, wordBuckets } from "./textMeasure.js";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("words on a screen (CC-313 section 3)", () => {
  // AC-7 (CC-313)
  it("sends word buckets, never words", async () => {
    vi.useFakeTimers();
    const telemetry = recordingTelemetry();
    const tracker = createInterruptionTracker({ telemetry, now: () => 0 });
    const api = fakeApi({ getFlags: vi.fn(async () => ({ interruption_counts: true })) });
    const words = Array.from({ length: 120 }, (_, index) => `Riya${index}`).join(" ");
    render(
      h(
        MemoryRouter,
        { initialEntries: ["/games/chess"] },
        h(
          ServicesContext.Provider,
          { value: { api, telemetry, interruptions: tracker } },
          h(
            SessionContext.Provider,
            { value: { status: "anonymous", identity: undefined } },
            h(InterruptionHost),
            h("main", null, h("p", null, words), h("p", { hidden: true }, "secret words not shown")),
          ),
        ),
      ),
    );
    // The flag's answer comes first, and only then does the second start.
    for (let tick = 0; tick < 5 && !tracker.isEnabled(); tick += 1) {
      await act(async () => vi.advanceTimersByTimeAsync(0));
    }
    expect(tracker.isEnabled()).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(TEXT_AFTER_MS - 1));
    expect(telemetry.named("screen_text_measured")).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(telemetry.named("screen_text_measured")).toEqual([{ words: "101-200", fold_words: "101-200" }]);
    expect(JSON.stringify(telemetry.tracked)).not.toMatch(/Riya|secret/);
  });

  it("counts every visible word, Hinglish and English alike, and only those above the fold for the fold", () => {
    document.body.innerHTML = `<main>
      <h1>Khelo aur jeeto</h1><p lang="en">Play and win</p>
      <p style="display:none">gone gone</p><p style="visibility:hidden">hidden too</p>
      <span aria-hidden="true">decor</span><div hidden><p>also gone</p></div>
      <p id="below">far down the page</p>
    </main>`;
    const view = { innerHeight: 800, getComputedStyle: window.getComputedStyle.bind(window) };
    const below = document.getElementById("below");
    const realRange = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = realRange();
      range.getBoundingClientRect = () => ({ top: range.startContainer.parentElement === below ? 2000 : 10 });
      return range;
    });

    expect(countWords(document.querySelector("main"), { view, document })).toEqual({
      words: 10,
      foldWords: 6,
    });
    expect(wordBuckets({ words: 0, foldWords: 51 })).toEqual({ words: "0-50", fold_words: "51-100" });
    expect(wordBuckets({ words: 401, foldWords: 201 })).toEqual({ words: "400+", fold_words: "201-400" });
  });

  it("measures nothing on a page without main, or with the flag off", async () => {
    vi.useFakeTimers();
    const telemetry = recordingTelemetry();
    const tracker = createInterruptionTracker({ telemetry, now: () => 0 });
    render(
      h(
        MemoryRouter,
        { initialEntries: ["/"] },
        h(
          ServicesContext.Provider,
          {
            value: {
              api: fakeApi({ getFlags: vi.fn(async () => ({ interruption_counts: true })) }),
              telemetry,
              interruptions: tracker,
            },
          },
          h(
            SessionContext.Provider,
            { value: { status: "anonymous", identity: undefined } },
            h(InterruptionHost),
          ),
        ),
      ),
    );
    await vi.advanceTimersByTimeAsync(TEXT_AFTER_MS * 2);

    expect(telemetry.named("screen_text_measured")).toEqual([]);
  });
});
