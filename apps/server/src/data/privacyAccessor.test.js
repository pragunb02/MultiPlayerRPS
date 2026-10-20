import { describe, expect, it } from "vitest";
import { createInMemoryPrivacyDao } from "../testing/inMemoryFriendDaos.js";
import { createPrivacyAccessor } from "./privacyAccessor.js";

const RIYA = "user_0123456789abcdef01234567";
const ARJUN = "user_ffffffffffffffffffffffff";

describe("privacy accessor (CC-052)", () => {
  it("needs its store", () => {
    expect(() => createPrivacyAccessor({})).toThrow(/privacyDao/);
  });

  it("answers who appears offline, nobody until someone chooses it, and asks nothing for nobody", async () => {
    const privacy = createPrivacyAccessor({ privacyDao: createInMemoryPrivacyDao() });

    expect(await privacy.appearingOffline([])).toEqual(new Set());
    expect(await privacy.appearingOffline([RIYA, ARJUN])).toEqual(new Set());

    await privacy.setAppearOffline({ playerId: RIYA, appearOffline: true, at: 1 });
    await privacy.setAppearOffline({ playerId: ARJUN, appearOffline: false, at: 2 });

    expect(await privacy.appearingOffline([RIYA, ARJUN])).toEqual(new Set([RIYA]));
    expect(await privacy.remove(RIYA)).toBe(1);
    expect(await privacy.appearingOffline([RIYA])).toEqual(new Set());
  });
});
