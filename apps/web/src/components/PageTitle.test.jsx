import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../testing/render.jsx";

const head = () => ({
  description: document.head.querySelectorAll('meta[name="description"]'),
  canonical: document.head.querySelector('link[rel="canonical"]'),
  robots: document.head.querySelector('meta[name="robots"]'),
});

describe("page head", () => {
  it.each([
    ["/", "/"],
    ["/games/chess", "/games/chess"],
    ["/leaderboards/weekly", "/leaderboards/weekly"],
    ["/privacy", "/privacy"],
    ["/terms", "/terms"],
  ])("gives %s one description and its canonical URL", async (path, canonical) => {
    renderApp({ path });

    await waitFor(() =>
      expect(head().canonical).toHaveAttribute("href", `http://localhost:3000${canonical}`),
    );
    expect(head().description).toHaveLength(1);
    expect(head().description[0].getAttribute("content")).not.toBe("");
    expect(head().robots).toBeNull();
  });

  it("names the game in a lobby's description", async () => {
    renderApp({ path: "/games/tic-tac-toe" });

    await waitFor(() => expect(head().description[0].getAttribute("content")).toContain("Tic Tac Toe"));
  });

  it.each(["/login", "/signup", "/profile", "/games/chess/rooms/AB2CD3", "/nope"])(
    "asks search engines not to list %s, and gives it no canonical URL",
    async (path) => {
      renderApp({ path });

      await waitFor(() => expect(head().robots).toHaveAttribute("content", "noindex"));
      expect(head().canonical).toBeNull();
      expect(head().description).toHaveLength(1);
    },
  );
});
