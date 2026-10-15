import MongoStore from "connect-mongo";

/**
 * Sessions are data we own, so they live in our database. A separate collection from the legacy
 * app's `sessions` keeps the two session formats from colliding while both run (CC-029 removes legacy).
 */
export const SESSION_COLLECTION = "player_sessions";

/**
 * Creates the store and waits until it is ready (collection resolved, TTL index created), so a
 * misconfigured database fails at boot and no setup work is still in flight when the app shuts down.
 *
 * @param {{ client: import("mongodb").MongoClient, ttlSeconds: number }} options
 * @returns {Promise<import("express-session").Store>}
 */
export async function createSessionStore({ client, ttlSeconds }) {
  const store = MongoStore.create({
    client,
    collectionName: SESSION_COLLECTION,
    ttl: ttlSeconds,
    autoRemove: "native", // MongoDB TTL index deletes expired sessions
    touchAfter: 60 * 60, // write an unchanged session at most once an hour
    stringify: false,
  });
  await store.collectionP;
  return store;
}
