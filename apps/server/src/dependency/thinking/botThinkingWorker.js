import { parentPort } from "node:worker_threads";
import { BOTS, createBotRegistry, createBotThinker } from "@classicade/games";

// A worker thread of botThinkingClient.js (ADR-067). It answers each turn with the same pure function the event
// loop uses, so a move is the same wherever it is chosen.
const thinker = createBotThinker(createBotRegistry(BOTS));

parentPort.on("message", ({ id, request }) => {
  try {
    parentPort.postMessage({ id, ok: true, move: thinker.think(request) });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      name: error?.name ?? "Error",
      message: String(error?.message ?? error),
    });
  }
});
