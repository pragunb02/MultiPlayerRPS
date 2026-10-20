import { describe } from "vitest";
import { runFeatureFlagDaoContract } from "./featureFlagDaoContract.js";
import { createInMemoryFeatureFlagDao } from "./inMemoryFeatureFlagDao.js";

describe("in-memory feature flag DAO (test double) honours the feature flag DAO contract", () => {
  runFeatureFlagDaoContract(async () => createInMemoryFeatureFlagDao());
});
