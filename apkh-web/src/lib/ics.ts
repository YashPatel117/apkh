/** A dated item for a calendar file. */
export interface CalendarItem {
  title: string;
  date: Date;
  description?: string;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "oct", "sept", "october" → 9; other words → -1. */
const monthIndex = (word: string) => (word.length < 3 ? -1 : MONTHS.findIndex((month) => month.startsWith(word)));

/**
 * A calendar day from a due date written by the AI ("2026-10-12", "Oct 12",
 * "12 October 2026", "10/12/2026"). Relative ones ("next week", "Friday") give
 * null: they can't be placed without guessing. A date without a year is the
 * next one to come.
 */
export function parseDueDate(text: string, now = new Date()): Date | null {
  const value = text.trim().toLowerCase();
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(value);
  if (iso) return validDay(+iso[1], +iso[2] - 1, +iso[3]);

  const slash = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(value);
  if (slash) {
    const year = +slash[3] < 100 ? 2000 + +slash[3] : +slash[3];
    return validDay(year, +slash[1] - 1, +slash[2]);
  }

  const monthFirst = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(value);
  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?(?:,?\s+(\d{4}))?\b/.exec(value);
  for (const [monthName, day, year] of [
    monthFirst && [monthFirst[1], monthFirst[2], monthFirst[3]],
    dayFirst && [dayFirst[2], dayFirst[1], dayFirst[3]],
  ].filter(Boolean) as string[][]) {
    const month = monthIndex(monthName);
    if (month === -1) continue;
    if (year) return validDay(+year, month, +day);
    const thisYear = validDay(now.getFullYear(), month, +day);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return thisYear && thisYear < today ? validDay(now.getFullYear() + 1, month, +day) : thisYear;
  }
  return null;
}

function validDay(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayStamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

/** Text value escaping (RFC 5545 §3.3.11). */
const escapeText = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets continue on the next line, indented by a space. */
function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (new TextEncoder().encode(current + char).length > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** An .ics file with one all-day event per item. */
export function buildIcs(items: CalendarItem[], calendarName: string): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Knowledge Hub//Action items//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escapeText(calendarName)}`];
  items.forEach((item, i) => {
    const end = new Date(item.date.getFullYear(), item.date.getMonth(), item.date.getDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${stamp}-${i}@knowledge-hub`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dayStamp(item.date)}`,
      `DTEND;VALUE=DATE:${dayStamp(end)}`,
      `SUMMARY:${escapeText(item.title)}`,
      ...(item.description ? [`DESCRIPTION:${escapeText(item.description)}`] : []),
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Saves text as a file. */
export function downloadText(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
