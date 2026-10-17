import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, fakeSocket, fakeSound, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";
import { installVisibility } from "../../testing/visibility.js";

// What a player hears and is asked in a room (CC-103, CC-104): sounds from room updates, the popup for a draw
// offer or a rematch request, the waiting card for the asker, answers as toasts, and the background tab title.

const ME = { playerId: GUEST.id, displayName: GUEST.displayName, connected: true };
const BOB = { playerId: "guest_b", displayName: "Bob", connected: true };
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

const chess = ({ view = {}, activePlayers = [GUEST.id], ...overrides } = {}) => ({
  code: "AB2CD3",
  gameId: "chess",
  status: "playing",
  hostId: GUEST.id,
  players: { min: 2, max: 2 },
  seats: [ME, BOB],
  you: GUEST.id,
  serverTime: 1_000_000,
  game: {
    view: {
      fen: START,
      moves: [],
      lastMove: {},
      colors: { [GUEST.id]: "w", [BOB.playerId]: "b" },
      toMove: GUEST.id,
      inCheck: false,
      timeControl: "blitz-5+0",
      clocks: { w: 300_000, b: 300_000 },
      lastMoveAt: 0,
      drawOfferBy: "",
      drawAnswer: "",
      ...view,
    },
    activePlayers,
    outcome: { status: "ongoing" },
  },
  ...overrides,
});

const WIN = { status: "finished", result: "win", winners: [GUEST.id], reason: "reached-target" };
// The rematch window ends half an hour after the game (CC-101).
const UNTIL = 1_000_000 + 30 * 60 * 1000;
const finished = (rematch = { requestedBy: [], available: true, declinedBy: "" }) => ({
  code: "AB2CD3",
  gameId: "ludo",
  status: "finished",
  hostId: GUEST.id,
  players: { min: 2, max: 2 },
  seats: [ME, BOB],
  you: GUEST.id,
  serverTime: 1_000_000,
  game: { view: {}, activePlayers: [], outcome: WIN },
  rematch: { until: UNTIL, ...rematch },
  series: { games: 1, wins: { [GUEST.id]: 1 } },
});
/** The rematch has started: the same room, playing again. */
const rematchStarted = () => ({
  ...finished(),
  status: "playing",
  game: { view: {}, activePlayers: [GUEST.id], outcome: { status: "ongoing" } },
  rematch: undefined,
});

/** Opens the room. The socket answers each request with `answers[event]` (a view, or a function giving one). */
function openRoom(joined, answers = {}) {
  const socket = fakeSocket();
  socket.connect();
  socket.request.mockImplementation(async (event, payload) => {
    if (event === "room:join") return joined;
    const answer = answers[event];
    return typeof answer === "function" ? answer(payload) : answer;
  });
  const sound = fakeSound();
  const path = `/games/${joined.gameId === "chess" ? "chess" : "ludo"}/rooms/AB2CD3`;
  const view = renderApp({ path, socket, sound, api: fakeApi({ getSession: async () => GUEST }) });
  return { ...view, socket, sound };
}

const push = (socket, room) => act(() => socket.push("room:updated", room));
// The popup is a region named after the request, in the page above the board (CC-104).
const POPUP = { name: /^(Draw offer|Rematch\?)$/ };
const popup = () => screen.findByRole("region", POPUP);
const noPopup = () => expect(screen.queryByRole("region", POPUP)).not.toBeInTheDocument();

// The chess board is downloaded the first time a room shows it. Under a busy test run that first download took
// longer than a query waits, so it is loaded once before the tests instead.
beforeAll(() => import("../../games/chess/ChessBoard.jsx"));
beforeEach(() => {
  installVisibility({ hidden: false });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("draw offers (CC-104)", () => {
  it("asks you in a popup with a chime, and accepting sends the answer", async () => {
    const user = userEvent.setup();
    const { socket, sound } = openRoom(chess(), { "game:move": () => chess() });
    await screen.findByRole("grid", { name: "Chess board" });

    push(socket, chess({ view: { drawOfferBy: BOB.playerId } }));

    const dialog = await popup();
    expect(dialog).toHaveAccessibleName("Draw offer");
    expect(dialog).toHaveAccessibleDescription("Bob offers a draw.");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Bob offers a draw.");
    expect(sound.played).toEqual(["notify"]);

    await user.click(within(dialog).getByRole("button", { name: "Accept" }));

    expect(socket.request).toHaveBeenCalledWith("game:move", {
      code: "AB2CD3",
      move: { type: "accept-draw" },
    });
    await waitFor(noPopup);
  });

  it("declines with Decline, and the game goes on", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom(chess({ view: { drawOfferBy: BOB.playerId } }), {
      "game:move": () => chess({ view: { drawAnswer: "declined" } }),
    });

    await user.click(within(await popup()).getByRole("button", { name: "Decline" }));

    expect(socket.request).toHaveBeenCalledWith("game:move", {
      code: "AB2CD3",
      move: { type: "decline-draw" },
    });
    await waitFor(noPopup);
    expect(screen.getByRole("grid", { name: "Chess board" })).toBeInTheDocument();
  });

  it("can be hidden without answering, with Hide or Escape, and the board stays usable", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom(chess({ view: { drawOfferBy: BOB.playerId } }));

    await user.click(within(await popup()).getByRole("button", { name: "Hide" }));
    noPopup();
    expect(screen.getByRole("gridcell", { name: "e2, white pawn" })).toBeEnabled();

    // The offer ends and a new one comes: that one is shown again.
    push(socket, chess({ view: { drawAnswer: "withdrawn" } }));
    push(socket, chess({ view: { drawOfferBy: BOB.playerId } }));
    const again = await popup();
    // Escape on the board is the board's (it puts a piece down). Inside the popup it hides the popup.
    await user.click(screen.getByRole("gridcell", { name: "e2, white pawn" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("region", POPUP)).toBeInTheDocument();
    within(again).getByRole("button", { name: "Decline" }).focus();
    await user.keyboard("{Escape}");
    noPopup();
  });

  it("closes by itself when the offer is withdrawn, and says so", async () => {
    const { socket, sound } = openRoom(chess({ view: { drawOfferBy: BOB.playerId } }));
    await popup();

    push(socket, chess({ view: { drawAnswer: "withdrawn" } }));

    await waitFor(noPopup);
    expect(await screen.findByText("Bob withdrew the draw offer")).toBeInTheDocument();
    expect(sound.played).toEqual(["notify"]);
  });

  it("shows the offerer a waiting card with Cancel, and tells them about a decline", async () => {
    const user = userEvent.setup();
    const offered = chess({ view: { drawOfferBy: GUEST.id }, activePlayers: [BOB.playerId] });
    const { socket } = openRoom(offered, { "game:move": () => chess({ view: { drawAnswer: "withdrawn" } }) });

    const card = await screen.findByRole("region", { name: "Draw offered" });
    expect(within(card).getByRole("status")).toHaveTextContent("Draw offered. Waiting for Bob…");
    noPopup();

    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(socket.request).toHaveBeenCalledWith("game:move", {
      code: "AB2CD3",
      move: { type: "withdraw-draw" },
    });
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Draw offered" })).not.toBeInTheDocument(),
    );

    push(socket, offered);
    push(socket, chess({ view: { drawAnswer: "declined" } }));
    expect(await screen.findByText("Bob declined your draw offer")).toBeInTheDocument();
  });

  it("explains an answer the server refused", async () => {
    const user = userEvent.setup();
    openRoom(chess({ view: { drawOfferBy: BOB.playerId } }), {
      "game:move": () => {
        throw new AppRequestError({ code: "VALIDATION_FAILED", message: "There is no draw offer to accept" });
      },
    });

    await user.click(within(await popup()).getByRole("button", { name: "Accept" }));

    expect(await screen.findByText("There is no draw offer to accept")).toBeInTheDocument();
    expect(within(screen.getByRole("region", POPUP)).getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("never takes focus: a player in the middle of a move keeps the board (CC-104)", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom(chess(), {
      "game:move": () => chess({ view: { fen: AFTER_E4, moves: ["e4"], drawOfferBy: BOB.playerId } }),
    });
    const e2 = await screen.findByRole("gridcell", { name: "e2, white pawn" });
    await user.click(e2);

    push(socket, chess({ view: { drawOfferBy: BOB.playerId } }));
    await popup();

    expect(e2).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}{Enter}");
    expect(socket.request).toHaveBeenCalledWith("game:move", {
      code: "AB2CD3",
      move: { type: "move", from: "e2", to: "e4" },
    });
  });

  it("leaves focus where the player put it while the popup was open", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom(chess());
    await screen.findByRole("grid", { name: "Chess board" });
    push(socket, chess({ view: { drawOfferBy: BOB.playerId } }));
    await popup();

    await user.click(screen.getByRole("gridcell", { name: "e2, white pawn" }));
    push(socket, chess({ view: { drawAnswer: "withdrawn" } }));

    await waitFor(noPopup);
    expect(screen.getByRole("gridcell", { name: /^e2/ })).toHaveFocus();
  });

  it("asks spectators nothing", async () => {
    openRoom(chess({ you: "", view: { drawOfferBy: BOB.playerId } }));

    await screen.findByRole("grid", { name: "Chess board" });
    noPopup();
    expect(screen.queryByRole("region", { name: "Draw offered" })).not.toBeInTheDocument();
  });
});

describe("rematch requests (CC-104)", () => {
  it("asks you in a popup, and Accept asks for the rematch too", async () => {
    const user = userEvent.setup();
    const { socket, sound } = openRoom(finished(), { "room:rematch": () => finished() });
    await screen.findByRole("heading", { name: "You won!" });

    push(socket, finished({ requestedBy: [BOB.playerId], available: true, declinedBy: "" }));
    const dialog = await popup();
    expect(dialog).toHaveAccessibleName("Rematch?");
    expect(dialog).toHaveAccessibleDescription("Bob wants a rematch.");
    expect(sound.played).toEqual(["notify"]);

    await user.click(within(dialog).getByRole("button", { name: "Accept" }));

    expect(socket.request).toHaveBeenCalledWith("room:rematch", { code: "AB2CD3" });
  });

  it("declines with Decline", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom(finished({ requestedBy: [BOB.playerId], available: true, declinedBy: "" }), {
      "room:rematch-decline": () => finished({ requestedBy: [], available: true, declinedBy: GUEST.id }),
    });

    await user.click(within(await popup()).getByRole("button", { name: "Decline" }));

    expect(socket.request).toHaveBeenCalledWith("room:rematch-decline", { code: "AB2CD3" });
    await waitFor(noPopup);
    expect(screen.getByText("You declined the rematch. Changed your mind?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rematch" })).toBeInTheDocument();
  });

  it("tells the asker who declined, and they can ask again", async () => {
    const { socket, sound } = openRoom(
      finished({ requestedBy: [GUEST.id], available: true, declinedBy: "" }),
    );
    await screen.findByText("Waiting for Bob…");

    push(socket, finished({ requestedBy: [], available: true, declinedBy: BOB.playerId }));

    expect(await screen.findByText("Bob declined the rematch")).toBeInTheDocument();
    expect(screen.getByText("Bob declined the rematch.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rematch" })).toBeEnabled();
    expect(sound.played).toEqual(["notify"]);
  });

  it("takes the decline message away once the rematch starts", async () => {
    const { socket } = openRoom(finished({ requestedBy: [GUEST.id], available: true, declinedBy: "" }));
    await screen.findByText("Waiting for Bob…");
    push(socket, finished({ requestedBy: [], available: true, declinedBy: BOB.playerId }));
    expect(await screen.findByText("Bob declined the rematch")).toBeInTheDocument();

    push(socket, rematchStarted());

    await waitFor(() => expect(screen.queryByText("Bob declined the rematch")).not.toBeInTheDocument());
  });

  it("tells the one asked when the request is taken back, and closes the popup", async () => {
    const { socket } = openRoom(finished({ requestedBy: [BOB.playerId], available: true, declinedBy: "" }));
    await popup();

    push(socket, finished());

    await waitFor(noPopup);
    expect(await screen.findByText("Bob took back the rematch request")).toBeInTheDocument();
  });

  it("closes the popup when the asker leaves", async () => {
    const { socket } = openRoom(finished({ requestedBy: [BOB.playerId], available: true, declinedBy: "" }));
    await popup();

    push(socket, finished({ requestedBy: [], available: false, declinedBy: "", leftName: "Bob" }));

    await waitFor(noPopup);
    expect(screen.getByText("Bob left, so there is no rematch this time.")).toBeInTheDocument();
  });

  it("tells the player still there, with a chime, the moment the opponent leaves the finished game (CC-162)", async () => {
    const { socket, sound } = openRoom(
      finished({ requestedBy: [ME.playerId], available: true, declinedBy: "" }),
    );
    await screen.findByRole("button", { name: "Cancel rematch" });

    push(socket, finished({ requestedBy: [], available: false, declinedBy: "", leftName: "Bob" }));

    expect(await screen.findByText("Bob left the room")).toBeInTheDocument();
    expect(sound.played).toEqual(["notify"]);
    expect(screen.queryByRole("button", { name: "Cancel rematch" })).not.toBeInTheDocument();
  });

  it("shows a reloaded page the same question, without a chime", async () => {
    const { sound } = openRoom(finished({ requestedBy: [BOB.playerId], available: true, declinedBy: "" }));

    expect(await popup()).toHaveAccessibleDescription("Bob wants a rematch.");
    expect(sound.played).toEqual([]);
  });
});

describe("room sounds (CC-103)", () => {
  it("plays nothing on joining and then the sound of each move", async () => {
    const { socket, sound } = openRoom(chess());
    await screen.findByRole("grid", { name: "Chess board" });
    expect(sound.played).toEqual([]);

    push(
      socket,
      chess({
        view: { fen: AFTER_E4, moves: ["e4"], toMove: BOB.playerId, lastMoveAt: 1_000_000 },
        activePlayers: [BOB.playerId],
      }),
    );

    expect(sound.played).toEqual(["move"]);
  });

  it("plays the start when the opponent joins and the game begins", async () => {
    const waiting = { ...chess(), status: "waiting", seats: [ME], game: undefined };
    const { socket, sound } = openRoom(waiting);
    await screen.findByRole("heading", { name: "Invite a friend" });

    push(socket, chess());

    expect(sound.played).toEqual(["game-start"]);
  });
});

describe("background tab (CC-104)", () => {
  it("calls you back with the tab title and a sound when it becomes your move", async () => {
    const tab = installVisibility({ hidden: false });
    const theirMove = chess({ view: { toMove: BOB.playerId }, activePlayers: [BOB.playerId] });
    const { socket, sound } = openRoom(theirMove);
    await screen.findByRole("grid", { name: "Chess board" });
    act(() => tab.setHidden(true));
    expect(document.title).toBe("Chess · Room AB2CD3 · ClassiCade");

    push(socket, chess({ view: { fen: AFTER_E4, moves: ["e4"] } }));

    expect(document.title).toBe("Your turn! · ClassiCade");
    expect(sound.played).toEqual(["move", "your-turn"]);

    act(() => tab.setHidden(false));
    expect(document.title).toBe("Chess · Room AB2CD3 · ClassiCade");
  });
});

describe("sound control in the header (CC-103)", () => {
  it("mutes and unmutes, named for what you hear", async () => {
    const user = userEvent.setup();
    const sound = fakeSound();
    renderApp({ sound });

    await user.click(screen.getByRole("button", { name: "Sound on" }));
    expect(sound.setMuted).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("slider", { name: "Volume" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Sound off" }));
    expect(sound.setMuted).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "Sound on" })).toBeInTheDocument();
  });

  it("sets the volume and plays a sample at the new level", () => {
    const sound = fakeSound();
    renderApp({ sound });

    const slider = screen.getByRole("slider", { name: "Volume" });
    expect(slider).toHaveValue("60");
    fireEvent.change(slider, { target: { value: "25" } });

    expect(sound.setVolume).toHaveBeenCalledWith(0.25);
    expect(sound.played).toEqual(["move"]);
  });

  it("shows sound off at zero volume, and turning it on raises the volume to the default", async () => {
    const user = userEvent.setup();
    const sound = fakeSound({ volume: 0 });
    renderApp({ sound });

    await user.click(screen.getByRole("button", { name: "Sound off" }));

    expect(sound.setVolume).toHaveBeenCalledWith(0.6);
    expect(screen.getByRole("button", { name: "Sound on" })).toBeInTheDocument();
  });

  it("starts muted when the player muted it before", () => {
    renderApp({ sound: fakeSound({ muted: true }) });

    expect(screen.getByRole("button", { name: "Sound off" })).toBeInTheDocument();
  });

  it("marks the app's buttons for the click sound", async () => {
    renderApp({ sound: fakeSound() });

    expect(await screen.findByRole("button", { name: "Play as a guest" })).toHaveAttribute(
      "data-sound",
      "click",
    );
  });
});
