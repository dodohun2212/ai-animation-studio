import { describe, expect, it } from "vitest";

import { formatDateTime } from "./formatDateTime.js";

describe("formatDateTime", () => {
  it("renders a stored UTC timestamp as local date and time in a fixed, sortable shape", () => {
    const iso = "2026-08-21T05:00:00.000Z";
    const local = new Date(iso);
    const pad = (value: number) => String(value).padStart(2, "0");
    const expected =
      `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}` +
      ` ${pad(local.getHours())}:${pad(local.getMinutes())}`;

    expect(formatDateTime(iso)).toBe(expected);
    // Always zero-padded to the same width so a column of timestamps stays aligned.
    expect(formatDateTime(iso)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("returns an unparseable value unchanged rather than rendering \"Invalid Date\"", () => {
    expect(formatDateTime("not a timestamp")).toBe("not a timestamp");
    expect(formatDateTime("")).toBe("");
  });
});
