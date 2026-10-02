export const QUIET_HOURS_DEFAULT = { start: "22:00", end: "07:00" } as const;

export const QUIET_EXEMPT_KINDS = [
  "offer",
  "ride_accepted",
  "ride_arrived",
  "ride_started",
  "ride_cancelled",
  "ride_rematching",
  "ride_interrupted",
  "no_driver",
  "pin_waived",
  "chat_message",
  "scheduled_confirm",
] as const;

export const quietHoursApplyTo = (kind: string) =>
  !(QUIET_EXEMPT_KINDS as readonly string[]).includes(kind);

export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function localMinutes(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return (hour % 24) * 60 + minute;
  } catch {
    return null;
  }
}

export function inQuietHours(
  range: { startMinute: number; endMinute: number; timeZone: string },
  now: Date,
): boolean {
  const local = localMinutes(now, range.timeZone);
  if (local === null || range.startMinute === range.endMinute) return false;
  return range.startMinute < range.endMinute
    ? local >= range.startMinute && local < range.endMinute
    : local >= range.startMinute || local < range.endMinute;
}
