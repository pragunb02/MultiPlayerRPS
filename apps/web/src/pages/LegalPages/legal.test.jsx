import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../testing/render.jsx";

const footer = () => screen.getByRole("contentinfo");

describe("footer", () => {
  it.each(["/", "/games/chess", "/leaderboards/overall", "/nope"])(
    "links the privacy policy and the terms on %s",
    async (path) => {
      renderApp({ path });

      const legal = within(footer()).getByRole("navigation", { name: "Legal" });
      expect(within(legal).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
      expect(within(legal).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    },
  );

  it("tells people about the one cookie in words, with no banner to dismiss", () => {
    renderApp({ path: "/" });

    expect(footer()).toHaveTextContent("One cookie keeps you signed in. No ads, no trackers.");
    expect(within(footer()).getByRole("link", { name: "How we use your data" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.queryByRole("button", { name: /accept|dismiss|close/i })).not.toBeInTheDocument();
  });
});

describe("legal pages", () => {
  it("shows the privacy policy, marked as a draft, under its own title", async () => {
    renderApp({ path: "/privacy" });

    expect(screen.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent("Draft.");
    expect(screen.getByRole("note")).toHaveTextContent("not legal advice");
    expect(screen.getByRole("heading", { name: "3. Cookies" })).toBeVisible();
    await waitFor(() => expect(document.title).toBe("Privacy policy · ClassiCade"));
  });

  it("shows the terms of use, marked as a draft, under its own title", async () => {
    renderApp({ path: "/terms" });

    expect(screen.getByRole("heading", { level: 1, name: "Terms of use" })).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent("waiting for review by a lawyer");
    await waitFor(() => expect(document.title).toBe("Terms of use · ClassiCade"));
  });

  it("goes from the footer to each page and back and forward through them", async () => {
    const user = userEvent.setup();
    const app = renderApp({ path: "/" });

    await user.click(within(footer()).getByRole("link", { name: "Privacy" }));
    expect(app.url()).toBe("/privacy");
    await user.click(screen.getByRole("link", { name: "terms of use" }));
    expect(app.url()).toBe("/terms");
    await user.click(within(screen.getByRole("main")).getByRole("link", { name: "privacy policy" }));
    expect(app.url()).toBe("/privacy");

    await app.back();
    expect(app.url()).toBe("/terms");
    expect(screen.getByRole("heading", { level: 1, name: "Terms of use" })).toBeVisible();
    await app.back();
    await app.back();
    expect(app.url()).toBe("/");
    await app.forward();
    expect(app.url()).toBe("/privacy");
    expect(screen.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
  });
});
