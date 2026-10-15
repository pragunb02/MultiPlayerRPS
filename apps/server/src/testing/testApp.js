import http from "node:http";
import session from "express-session";
import { createIdentityComponent } from "../domain/identity/identityComponent.js";
import { createHttpApp } from "../service/http/app.js";
import { createSessionMiddleware } from "../service/http/session.js";
import { createRealtimeGateway } from "../service/realtime/gateway.js";
import { captureLogger } from "./captureLogger.js";
import { testConfig } from "./testConfig.js";

/**
 * Wires the service layer the same way the composition root does, but with an in-memory session
 * store and deterministic guests — fast tests without a database.
 *
 * @param {{ env?: Record<string, string>, guestLimit?: { windowMs: number, limit: number } }} [options]
 */
export function createTestApp({ env = {}, guestLimit } = {}) {
  const config = testConfig(env);
  const capture = captureLogger();
  const store = new session.MemoryStore();
  const sessionMiddleware = createSessionMiddleware({
    store,
    secret: config.sessionSecret,
    secureCookies: config.isProduction,
  });
  let guestNumber = 0;
  const identityComponent = createIdentityComponent({
    generateId: () => `00000000-0000-4000-8000-${String(++guestNumber).padStart(12, "0")}`,
    generateGuestSuffix: () => `T${String(guestNumber).padStart(3, "0")}`,
  });
  const endedSessions = [];
  const endedListeners = [];

  const app = createHttpApp({
    config,
    logger: capture.logger,
    sessionMiddleware,
    identityComponent,
    guestLimit,
    onSessionEnded: (sessionId) => {
      endedSessions.push(sessionId);
      endedListeners.forEach((listener) => listener(sessionId));
    },
  });

  return {
    app,
    config,
    store,
    sessionMiddleware,
    endedSessions,
    onSessionEnded: (listener) => endedListeners.push(listener),
    ...capture,
  };
}

/**
 * Starts the HTTP app plus the realtime gateway on a random local port.
 *
 * @param {Parameters<typeof createTestApp>[0]} [options]
 */
export async function startTestServer(options) {
  const testApp = createTestApp(options);
  const server = http.createServer(testApp.app);
  const gateway = createRealtimeGateway({
    httpServer: server,
    sessionMiddleware: testApp.sessionMiddleware,
    allowedOrigins: testApp.config.allowedOrigins,
    logger: testApp.logger,
  });
  testApp.onSessionEnded((sessionId) => gateway.disconnectSession(sessionId));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return { ...testApp, gateway, baseUrl: `http://127.0.0.1:${port}`, close: () => gateway.close() };
}
