import { describe, expect, it, vi } from "vitest";
import { createDownload } from "./download.js";

describe("createDownload", () => {
  it("saves indented JSON under the file name, and leaves nothing behind in the page", async () => {
    const made = [];
    const URL = {
      createObjectURL: vi.fn((blob) => {
        made.push(blob);
        return "blob:export";
      }),
      revokeObjectURL: vi.fn(),
    };
    const clicked = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function record() {
      clicked.push({ href: this.getAttribute("href"), download: this.download, inPage: this.isConnected });
    });

    createDownload({ document, URL }).saveJson({ filename: "classicade-data.json", data: { a: 1 } });

    expect(clicked).toEqual([{ href: "blob:export", download: "classicade-data.json", inPage: true }]);
    expect(made[0].type).toBe("application/json");
    expect(await made[0].text()).toBe('{\n  "a": 1\n}\n');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:export");
    expect(document.querySelector("a[download]")).toBeNull();
    click.mockRestore();
  });
});
