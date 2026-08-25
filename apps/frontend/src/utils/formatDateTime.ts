/**
 * Formats a stored ISO timestamp for display as local date and time.
 *
 * Stored timestamps are UTC ISO strings (`2026-08-21T05:00:00.000Z`). Rendering them raw shows the user a
 * machine string in a timezone that is not theirs; this converts to their local time in a fixed, sortable
 * `YYYY-MM-DD HH:MM` shape rather than a locale-dependent one, so the column stays aligned and scannable.
 *
 * An unparseable value is returned unchanged — a timestamp we cannot read is still better shown as-is than
 * replaced with "Invalid Date".
 */
export function formatDateTime(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}` +
    ` ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  );
}
