require("dotenv").config();

// Legacy deployments set MONGO_URI_PRODUCTION; MONGO_URI is the name going forward.
const mongoUri = process.env.MONGO_URI || process.env.MONGO_URI_PRODUCTION;
const sessionSecret = process.env.SESSION_SECRET;

const missing = [];
if (!mongoUri) missing.push("MONGO_URI");
if (!sessionSecret) missing.push("SESSION_SECRET");
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}. See .env.example.`);
  process.exit(1);
}

module.exports = {
  isProduction: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT) || 8080,
  mongoUri,
  sessionSecret,
};
