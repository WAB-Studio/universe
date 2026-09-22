// The only file under `apps/pulsar` allowed to name a time zone. Every other
// module reaches the person's day through the functions below, never through
// `Date`'s local-offset behaviour or the process's own `TZ`.
export const TIME_ZONE = "America/Bogota";

// Any instant, read back as its calendar day in the person's zone. `Intl`
// takes the zone as an argument, so this never depends on the process's own
// `TZ` — a suite run under `TZ=UTC` reads the same day as one run without it.
export function civilDateInZone(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(instant);
}

export function todayInZone(): string {
  return civilDateInZone(new Date());
}

// Rejects a shape match that names no real day, such as "2026-02-31".
export function isCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Midday UTC is the only instant a formatter is ever handed: every zone west
// of UTC+12 and east of UTC-12 still renders this as the same calendar day,
// so the naive `new Date("2026-08-27")` off-by-one-day bug cannot happen.
export function civilDateToDate(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

// Reads a midday-UTC instant back as its own calendar day, never a shifted one.
function dateToCivilDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(date);
}

// The seven civil days of the Monday-to-Sunday week `day` sits in, oldest
// first. The day-of-week is read from the midday-UTC instant, so no local
// offset shifts it.
export function weekOf(day: string): string[] {
  const monday = civilDateToDate(day);
  // `getUTCDay` is 0 for Sunday; `+ 6 mod 7` counts the days back to Monday.
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));

  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(dateToCivilDate(monday));
    monday.setUTCDate(monday.getUTCDate() + 1);
  }
  return days;
}
