import session from "express-session";
import { describe } from "vitest";
import { createMemoryStoreSessionDao } from "./memoryStoreSessionDao.js";
import { runSessionDaoContract } from "./sessionDaoContract.js";

describe("memory store session DAO (test double) honours the session DAO contract", () => {
  runSessionDaoContract(async () => {
    const store = new session.MemoryStore();
    return { store, dao: createMemoryStoreSessionDao({ store }) };
  });
});
