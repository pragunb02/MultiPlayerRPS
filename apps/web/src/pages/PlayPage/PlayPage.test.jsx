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
    const { api } = renderApp({ path: "/play/rps", socket });

    await user.selectOptions(screen.getByRole("combobox", { name: /match length/i }), "5");
    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(api.startGuest).toHaveBeenCalledOnce();
    expect(socket.request).toHaveBeenCalledWith("room:create", { gameId: "rps", options: { bestOf: 5 } });
    expect(await screen.findByText(/Joining room AB2CD3/)).toBeInTheDocument();
  });

  it("offers chess time controls", () => {
    renderApp({ path: "/play/chess" });

    expect(screen.getByRole("combobox", { name: /time control/i })).toHaveDisplayValue("Blitz 5 min");
  });

  it("shows an error when the room cannot be created", async () => {
    const user = userEvent.setup();
    const socket = fakeSocket();
    socket.request.mockRejectedValue(new Error("Slow down — too many requests"));
    renderApp({ path: "/play/tictactoe", socket });

    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Slow down");
  });

  it("joins by code (normalised), enabling the button only for a full code", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/play/rps" });
    const join = screen.getByRole("button", { name: "Join room" });

    expect(join).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Room code" }), "ab2cd3");
    await user.click(join);

    expect(await screen.findByText(/Joining room AB2CD3/)).toBeInTheDocument();
  });

  it("shows not-found for an unknown game", () => {
    renderApp({ path: "/play/ludo" });

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
