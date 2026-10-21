import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminRoute,
  LAZY_ROUTES,
  NotFoundPage,
  PlayPage,
  preloadRouteFor,
  PrivacyPage,
  RoomPage,
} from "./routePages.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Watches every page's download without starting any. */
function watchDownloads() {
  const asked = [];
  for (const { page } of LAZY_ROUTES) {
    if (page !== null) {
      vi.spyOn(page, "preload").mockImplementation(async () => {
        asked.push(page);
      });
    }
  }
  return asked;
}

describe("preloadRouteFor: the page an address opens, fetched before it is needed (CC-322)", () => {
  it("fetches the page the router would show, by the router's own ranking", async () => {
    const asked = watchDownloads();

    await preloadRouteFor("/games/chess");
    await preloadRouteFor("/games/chess/rooms/AB2CD3");
    await preloadRouteFor("/privacy");
    await preloadRouteFor("/play/chess");

    expect(asked).toEqual([PlayPage, RoomPage, PrivacyPage, PlayPage]);
  });

  it("fetches the console's gate for the console, and the not-found page for an unknown address", async () => {
    const asked = watchDownloads();

    await preloadRouteFor("/admin/flags");
    await preloadRouteFor("/nope/at/all");

    expect(asked).toEqual([AdminRoute, NotFoundPage]);
  });

  it("fetches nothing for home, which is in the first download", async () => {
    const asked = watchDownloads();

    await preloadRouteFor("/");

    expect(asked).toEqual([]);
  });

  it("settles even when the download fails, so the first render is never held back by it", async () => {
    vi.spyOn(PlayPage, "preload").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(preloadRouteFor("/games/chess")).resolves.toBeUndefined();
  });
});
