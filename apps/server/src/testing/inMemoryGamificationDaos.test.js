import { describe } from "vitest";
import {
  runAchievementDaoContract,
  runQuestDaoContract,
  runStatsDaoContract,
} from "./gamificationDaoContract.js";
import {
  createInMemoryAchievementDao,
  createInMemoryQuestDao,
  createInMemoryStatsDao,
} from "./inMemoryGamificationDaos.js";

describe("in-memory gamification DAOs (test doubles) honour the DAO contracts", () => {
  runStatsDaoContract(async () => createInMemoryStatsDao());
  runQuestDaoContract(async () => createInMemoryQuestDao());
  runAchievementDaoContract(async () => createInMemoryAchievementDao());
});
