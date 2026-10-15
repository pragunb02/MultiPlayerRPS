import express from "express";
import helmet from "helmet";
import { apiRouter } from "./routes.js";
import { errorHandler, notFoundHandler } from "./errorMiddleware.js";

/**
 * Service layer entry point for HTTP: creates the Express app without binding a port,
 * so tests can drive it in-process.
 *
 * @param {{ config: Readonly<import("../../config/index.js").Config> }} deps
 */
export function createHttpApp({ config }) {
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
