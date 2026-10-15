import express from "express";
import helmet from "helmet";
import { apiRouter } from "./http/routes/index.js";
import { errorHandler, notFoundHandler } from "./http/middleware/errors.js";

/**
 * Creates the Express app without binding a port, so tests can drive it in-process.
 *
 * @param {{ config: Readonly<import("./config/index.js").Config> }} deps
 */
export function createApp({ config }) {
  const app = express();

  app.disable("x-powered-by");
  if (config.isProduction) {
    app.set("trust proxy", 1);
  }
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));

  app.use("/api", apiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
