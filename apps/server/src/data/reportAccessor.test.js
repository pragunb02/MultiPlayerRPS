import { describe, expect, it } from "vitest";
import { createInMemoryReportDao } from "../testing/inMemoryReportDao.js";
import { NotFoundError } from "../utils/errors.js";
import { createReportAccessor } from "./reportAccessor.js";

const T0 = Date.UTC(2026, 9, 20, 12);
const RIYA = "user_0123456789abcdef01234567";
const ARJUN = "user_ffffffffffffffffffffffff";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";

let counter = 0;
const input = ({ at = T0, ...rest } = {}) => ({
  reportId: `00000000-0000-4000-c000-${String(++counter).padStart(12, "0")}`,
  reporterId: RIYA,
  reportedId: ARJUN,
  reportedName: "Arjun",
  reason: "cheating",
  context: {
    kind: "match",
    gameId: "chess",
    matchId: "11111111-2222-4333-8444-555555555555",
    recent: [{ by: "reported", kind: "move", text: '"e4"', at: T0 - 1000 }],
  },
  day: "2026-10-20",
  setAside: false,
  at,
  ...rest,
});

describe("reportAccessor (CC-044, ADR-071)", () => {
  it("stores a new report as open, and answers a frozen model with times in milliseconds", async () => {
    const reports = createReportAccessor({ reportDao: createInMemoryReportDao() });
    const report = input({ note: "Too fast" });

    const { created, report: stored } = await reports.add(report);

    const { at, ...fields } = report;
    expect(created).toBe(true);
    expect(stored).toEqual({ ...fields, status: "open", createdAt: at });
    expect(Object.isFrozen(stored)).toBe(true);
    expect(await reports.get(report.reportId)).toEqual(stored);
  });

  it("answers the day's report again for a repeat by the same reporter on the same player, without storing it", async () => {
    const reports = createReportAccessor({ reportDao: createInMemoryReportDao() });
    const first = (await reports.add(input())).report;

    const again = await reports.add(input({ reason: "name", at: T0 + 60_000 }));

    expect(again).toEqual({ created: false, report: first });
    expect(await reports.listByReporter(RIYA)).toEqual([first]);
  });

  it("answers NotFoundError for a report that is not there", async () => {
    const reports = createReportAccessor({ reportDao: createInMemoryReportDao() });

    await expect(reports.get("00000000-0000-4000-c000-ffffffffffff")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists open reports, those about a player, closes them with the action and moves and erases them", async () => {
    const reports = createReportAccessor({ reportDao: createInMemoryReportDao() });
    const about = (await reports.add(input())).report;
    const other = (await reports.add(input({ reportedId: GUEST, day: "2026-10-18" }))).report;

    expect((await reports.listByStatus({ status: "open", limit: 10 })).map((r) => r.reportId).sort()).toEqual(
      [about.reportId, other.reportId].sort(),
    );
    expect(await reports.listOpenAbout(ARJUN)).toEqual([about]);
    expect(await reports.closeOpen({ reportedId: ARJUN, status: "dismissed", action: "dismiss", at: T0 + 5 })).toBe(
      1,
    );
    expect(await reports.get(about.reportId)).toEqual({
      ...about,
      status: "dismissed",
      action: "dismiss",
      closedAt: T0 + 5,
    });
    const guests = (await reports.add(input({ reporterId: GUEST, day: "2026-10-19" }))).report;
    expect(await reports.moveReporter({ from: GUEST, to: ARJUN })).toBe(0);
    expect(await reports.moveReported({ from: GUEST, to: ARJUN })).toBe(1);
    expect(await reports.anonymiseReporter({ reporterId: GUEST, standIn: () => "deleted_x" })).toBe(0);
    expect((await reports.get(other.reportId)).reportedId).toBe(ARJUN);
    expect(await reports.removeAbout(ARJUN)).toBe(2);
    await expect(reports.get(guests.reportId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
