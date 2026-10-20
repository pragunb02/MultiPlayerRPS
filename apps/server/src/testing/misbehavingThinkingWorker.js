import { parentPort, threadId } from "node:worker_threads";

/**
 * A thinking worker for tests that misbehaves on purpose, picked by the request's game: `hang` never answers,
 * `throw` throws outside any handler, `exit` ends the thread, `hog` fills its heap. Any other request is answered
 * with its seed and the thread's id, so a test can tell a replaced thread from the first one.
 */
parentPort.on("message", ({ id, request }) => {
  if (request.gameId === "hang") {
    for (;;);
  }
  if (request.gameId === "throw") {
    setImmediate(() => {
      throw new Error("a thinking thread failed");
    });
    return;
  }
  if (request.gameId === "exit") {
    process.exit(3);
  }
  if (request.gameId === "hog") {
    const kept = [];
    for (;;) kept.push(new Array(1_000_000).fill(kept.length));
  }
  parentPort.postMessage({ id, ok: true, move: { seed: request.seed, thread: threadId } });
});
