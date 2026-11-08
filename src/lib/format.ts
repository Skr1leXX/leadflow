export const initials = (name: string) =>
  name.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

// All dates are shown in one fixed zone so server and client render identically.
// Moscow has no DST, so a constant offset is correct.
export const APP_TZ = "Europe/Moscow";
export const APP_OFFSET = "+03:00";

/** "2026-11-05" for an ISO timestamp, in APP_TZ. */
export const ymd = (iso: string | Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: APP_TZ }).format(new Date(iso));

export const hm = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: APP_TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: APP_TZ,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export const dateShort = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: APP_TZ, day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso),
  );

/** Combines a date ("2026-11-05") and optional time ("15:00") entered by the user into an ISO instant. */
export const toInstant = (date: string, time = "12:00") => new Date(`${date}T${time}:00${APP_OFFSET}`).toISOString();

/** Start of a Moscow-time day ("YYYY-MM-DD") as an ISO instant, optionally shifted by whole days. */
export const dayStartIso = (day: string, plusDays = 0) => new Date(new Date(`${day}T00:00:00${APP_OFFSET}`).getTime() + plusDays * 86_400_000).toISOString();

/** "YYYY-MM-DD" shifted by whole days (calendar arithmetic, independent of the machine's time zone). */
export const addDaysTo = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const dateTimeFull = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: APP_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
