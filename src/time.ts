// Timezone helpers built on Intl only (no date library). Clinic schedules are
// defined in clinic-local wall time; everything is stored in UTC ISO strings.

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function parts(date: Date, timeZone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
  });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetMs(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts clinic-local "YYYY-MM-DD" + "HH:MM" to a UTC Date. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes handle instants near a DST transition.
  let utc = guess - offsetMs(new Date(guess), timeZone);
  utc = guess - offsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

/** Clinic-local "YYYY-MM-DD" for an instant. */
export function localDate(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Clinic-local "YYYY-MM-DDTHH:MM" for an instant. */
export function localDateTime(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "mon".."sun" for a clinic-local date string. */
export function weekdayOf(date: string): (typeof WEEKDAYS)[number] {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Human-friendly clinic-local time, e.g. "Tue, Nov 4 at 2:30 PM". */
export function formatLocal(iso: string | Date, timeZone: string): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
  return `${day} at ${time}`;
}

/** Parses "YYYY-MM-DDTHH:MM" clinic-local (or a full ISO string with offset) to a UTC Date. */
export function parseLocalDateTime(value: string, timeZone: string): Date | undefined {
  if (/[zZ]|[+-]\d\d:\d\d$/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})/.exec(value);
  return match ? zonedToUtc(match[1], match[2], timeZone) : undefined;
}
