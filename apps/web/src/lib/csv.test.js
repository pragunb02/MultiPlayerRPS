import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadCsv, toCsv } from "./csv.js";

afterEach(() => vi.useRealTimers());

describe("toCsv", () => {
  it("writes a header and one quoted-when-needed row per item, with CRLF line ends", () => {
    const text = toCsv({
      columns: [
        { label: "Name", value: (row) => row.name },
        { label: "Count", value: (row) => row.count },
      ],
      rows: [
        { name: "Plain", count: 3 },
        { name: 'Has "quotes", commas', count: -2 },
        { name: "Two\nlines", count: 0 },
      ],
    });

    expect(text).toBe('Name,Count\r\nPlain,3\r\n"Has ""quotes"", commas",-2\r\n"Two\nlines",0\r\n');
  });

  it("stops a spreadsheet from running a cell as a formula", () => {
    const text = toCsv({
      columns: [{ label: "x", value: (row) => row }],
      rows: ["=SUM(A1)", "+1+1", "@me", "-x"],
    });

    expect(text).toBe("x\r\n'=SUM(A1)\r\n'+1+1\r\n'@me\r\n'-x\r\n");
  });
});

describe("downloadCsv", () => {
  it("clicks a temporary download link and releases the file later", async () => {
    vi.useFakeTimers();
    const url = { createObjectURL: vi.fn(() => "blob:csv"), revokeObjectURL: vi.fn() };
    const clicked = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function record() {
      clicked.push({ href: this.href, download: this.download });
    });

    downloadCsv({ filename: "totals.csv", text: "a\r\n", url });

    expect(clicked).toEqual([{ href: "blob:csv", download: "totals.csv" }]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(await url.createObjectURL.mock.calls[0][0].text()).toBe("a\r\n");
    expect(url.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(url.revokeObjectURL).toHaveBeenCalledWith("blob:csv");
    click.mockRestore();
  });
});
