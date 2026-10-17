/**
 * A table as CSV text (RFC 4180): a header row, then one row per item, cells quoted when they hold a comma, a
 * quote or a line break. A cell that starts with an equals sign, a plus, a minus or an at sign gets a leading
 * apostrophe, so a spreadsheet never runs it as a formula. Lines end with CRLF, which every spreadsheet reads.
 *
 * @param {{ columns: ReadonlyArray<{ label: string, value: (row: any) => string | number }>, rows: ReadonlyArray<any> }} table
 * @returns {string}
 */
export function toCsv({ columns, rows }) {
  const lines = [
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((c) => c.value(row))),
  ];
  return `${lines.map((cells) => cells.map(cell).join(",")).join("\r\n")}\r\n`;
}

function cell(value) {
  const text = String(value);
  const safe = /^[=+\-@]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * Saves CSV text as a file through the browser's own download, without a request to the server. The link it
 * clicks is made and removed at once, and the file's address is released 10 seconds later.
 *
 * @param {{ filename: string, text: string, document?: Document, url?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> }} file
 *   `document` and `url` are for tests
 */
export function downloadCsv({ filename, text, document = window.document, url = URL }) {
  const address = url.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = address;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers read the file a moment after the click, so the address stays valid for a while.
  setTimeout(() => url.revokeObjectURL(address), RELEASE_AFTER_MS);
}

const RELEASE_AFTER_MS = 10_000;
