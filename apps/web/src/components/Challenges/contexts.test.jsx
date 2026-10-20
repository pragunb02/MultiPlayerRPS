import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInGame, useMarkInGame } from "../SiteRequests/inGameContext.js";
import { useChallengeInbox } from "./challengesContext.js";

// The challenges and the in-game state live in the layout (CC-139, CC-207). Read anywhere else, they fail loudly
// instead of quietly showing nothing.
describe("the request contexts outside their providers", () => {
  it.each([
    ["useChallengeInbox", useChallengeInbox],
    ["useInGame", useInGame],
    ["useMarkInGame", () => useMarkInGame(true)],
  ])("%s throws", (_name, hook) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderHook(hook)).toThrow(/inside </);

    vi.restoreAllMocks();
  });
});
