import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeSocket } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

describe("PlayPage", () => {
  it("creates a room with the game's options (starting a guest first) and opens it", async () => {
    const user = userEvent.setup();
    const socket = fakeSocket();
    socket.request.mockImplementation(async (event) =>
      event === "room:create" ? { code: "AB2CD3" } : new Promise(() => {}),
    );
    const { api } = renderApp({ path: "/games/rock-paper-scissors", socket });

    await user.selectOptions(screen.getByRole("combobox", { name: /match length/i }), "5");
    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(api.startGuest).toHaveBeenCalledOnce();
    expect(socket.request).toHaveBeenCalledWith("room:create", { gameId: "rps", options: { bestOf: 5 } });
    expect(await screen.findByText(/Joining room AB2CD3/)).toBeInTheDocument();
  });

  it("shows the game's banner with its art and accent", () => {
    renderApp({ path: "/games/tic-tac-toe" });

    const banner = screen.getByRole("heading", { level: 1, name: "Tic Tac Toe" }).parentElement;
    expect(banner).toHaveClass("tictactoe");
    expect(banner.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("offers chess time controls", () => {
    renderApp({ path: "/games/chess" });

    expect(screen.getByRole("combobox", { name: /time control/i })).toHaveDisplayValue("Blitz 5 min");
  });

  it("creates a chess room with the chosen time control", async () => {
    const user = userEvent.setup();
    const socket = fakeSocket();
    socket.request.mockImplementation(async (event) =>
      event === "room:create" ? { code: "AB2CD3" } : new Promise(() => {}),
    );
    renderApp({ path: "/games/chess", socket });

    await user.selectOptions(screen.getByRole("combobox", { name: /time control/i }), "Rapid 15 min + 10 s");
    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(socket.request).toHaveBeenCalledWith("room:create", {
      gameId: "chess",
      options: { timeControl: "rapid-15+10" },
    });
  });

  it("shows an error when the room cannot be created", async () => {
    const user = userEvent.setup();
    const socket = fakeSocket();
    socket.request.mockRejectedValue(new Error("Slow down — too many requests"));
    renderApp({ path: "/games/tic-tac-toe", socket });

    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Slow down");
  });

  it("joins by code (normalised), enabling the button only for a full code", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/games/rock-paper-scissors" });
    const join = screen.getByRole("button", { name: "Join room" });

    expect(join).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Room code" }), "ab2cd3");
    await user.click(join);

    // A visitor without a session first chooses how to join (CC-086).
    expect(
      await screen.findByRole("heading", { name: "You're invited to play Rock Paper Scissors" }),
    ).toBeInTheDocument();
    expect(screen.getByText("AB2CD3")).toBeInTheDocument();
  });

  it("shows not-found for an unknown game", () => {
    renderApp({ path: "/games/ludo" });

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
