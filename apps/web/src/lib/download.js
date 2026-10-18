/**
 * Saves data as a file the browser downloads, without another request to the server (CC-035). The file is made in
 * the page and handed to a link with `download`, which the browser saves instead of opening.
 *
 * @param {{ document: Document, URL: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> }} deps
 */
export function createDownload({ document, URL }) {
  return Object.freeze({
    /**
     * @param {{ filename: string, data: unknown }} file  `data` is written as indented JSON
     */
    saveJson({ filename, data }) {
      const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    },
  });
}
