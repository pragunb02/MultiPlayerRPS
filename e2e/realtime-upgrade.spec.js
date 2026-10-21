import { E2E_PORT } from "./personas.js";
import { createRoom, expect, test } from "./fixtures.js";

// The realtime connection's upgrade, and what the players check makes of it (CC-335). Chromium's network log ends
// the request of every WebSocket that upgraded with `ERR_WS_UPGRADE`, which is how Chromium marks a successful
// upgrade, not a failure. So the log cannot tell a test whether an upgrade failed. These tests show what does: a
// refused upgrade fails the players check in every engine, while the closes that come with a reload or a person
// leaving do not.

/** The address the run's certificate also names, which is not one of the server's allowed origins. */
const FOREIGN_SITE = `https://127.0.0.1:${E2E_PORT}`;

/**
 * Opens a WebSocket on the realtime path from the page and waits until it opens or fails.
 *
 * @returns {Promise<"open" | "failed">}
 */
const openRealtimeSocket = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const socket = new WebSocket(`wss://${location.host}/socket.io/?EIO=4&transport=websocket`);
        socket.onopen = () => {
          socket.close();
          resolve("open");
        };
        socket.onerror = () => resolve("failed");
      }),
  );

test("the app's realtime connection upgrades, and a reload or leaving closes it without a problem", async ({
  players,
}) => {
  const host = await players.open("Host");
  const upgraded = [];
  host.page.on("websocket", (socket) =>
    socket.on("framereceived", () => upgraded.includes(socket) || upgraded.push(socket)),
  );
  await createRoom(host, "rps");
  await host.page.reload();
  await host.page.getByRole("heading", { name: "Invite a friend" }).waitFor();
  // One socket before the reload and one after, and the server spoke on both, so both upgraded.
  await expect.poll(() => upgraded.length).toBe(2);
  // The checks run here, before the browser closes, as at the end of every test.
  await host.leave();
});

test("a refused upgrade fails the players check", async ({ players }) => {
  const stranger = await players.open("Stranger");
  await stranger.page.goto(`${FOREIGN_SITE}/`);
  // The server's origin check answers the upgrade from a site it does not allow with 400, before any 101.
  expect(await openRealtimeSocket(stranger.page)).toBe("failed");
  await expect
    .poll(() => stranger.record.problems.length, { message: "the refused upgrade was reported" })
    .toBeGreaterThan(0);
  const problems = stranger.takeProblems();
  expect(problems, "only the refused upgrade, once").toHaveLength(1);
  expect(problems[0]).toContain(`${FOREIGN_SITE.replace("https", "wss")}/socket.io/`);
});
