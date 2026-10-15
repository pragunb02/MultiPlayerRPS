import { existsSync } from "node:fs";
import { loadConfig } from "./config/index.js";
import { handleShutdownSignals, startServer } from "./server.js";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const { port, close } = await startServer({ config });
console.log(`ClassiCade server listening on port ${port} (${config.env})`);
handleShutdownSignals(close);
