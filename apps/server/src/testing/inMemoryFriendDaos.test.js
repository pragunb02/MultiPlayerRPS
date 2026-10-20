import { describe } from "vitest";
import {
  runFriendLinkDaoContract,
  runFriendRequestDaoContract,
  runFriendshipDaoContract,
  runPrivacyDaoContract,
} from "./friendDaoContracts.js";
import {
  createInMemoryFriendLinkDao,
  createInMemoryFriendRequestDao,
  createInMemoryFriendshipDao,
  createInMemoryPrivacyDao,
} from "./inMemoryFriendDaos.js";

describe("in-memory friendship DAO (test double) honours the friendship DAO contract", () => {
  runFriendshipDaoContract(async () => createInMemoryFriendshipDao());
});

describe("in-memory friend request DAO (test double) honours the friend request DAO contract", () => {
  runFriendRequestDaoContract(async () => createInMemoryFriendRequestDao());
});

describe("in-memory friend link DAO (test double) honours the friend link DAO contract", () => {
  runFriendLinkDaoContract(async () => createInMemoryFriendLinkDao());
});

describe("in-memory privacy DAO (test double) honours the privacy DAO contract", () => {
  runPrivacyDaoContract(async () => createInMemoryPrivacyDao());
});
