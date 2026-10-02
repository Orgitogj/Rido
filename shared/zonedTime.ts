const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseLocalTime(local: string) {
  const m = LOCAL.exec(local);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  return { year, month, day, hour, minute, asUtc: utc };
}

export function formatInZone(instant: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const hour = get("hour") === "24" ? "00" : get("hour");
    return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
  } catch {
    return null;
  }
}

export function zoneOffsetMinutes(instant: Date, timeZone: string) {
  const local = formatInZone(instant, timeZone);
  const parsed = local ? parseLocalTime(local) : null;
  if (!parsed) return null;
  const truncated = Math.floor(instant.getTime() / 60_000) * 60_000;
  return Math.round((parsed.asUtc - truncated) / 60_000);
}

export type ZonedResolution =
  | { kind: "ok"; instant: Date }
  | { kind: "ambiguous"; earlier: Date; later: Date }
  | { kind: "nonexistent" }
  | { kind: "invalid" };

export function resolveLocalTime(
  local: string,
  timeZone: string,
): ZonedResolution {
  const parsed = parseLocalTime(local);
  if (!parsed) return { kind: "invalid" };
  const day = 24 * 3600 * 1000;
  const offsets = new Set<number>();
  for (const probe of [parsed.asUtc - day, parsed.asUtc, parsed.asUtc + day]) {
    const offset = zoneOffsetMinutes(new Date(probe), timeZone);
    if (offset === null) return { kind: "invalid" };
    offsets.add(offset);
  }
  const instants = [...offsets]
    .map((offset) => new Date(parsed.asUtc - offset * 60_000))
    .filter((instant) => formatInZone(instant, timeZone) === local)
    .sort((a, b) => a.getTime() - b.getTime());
  if (instants.length === 0) return { kind: "nonexistent" };
  if (instants.length === 1) return { kind: "ok", instant: instants[0] };
  return {
    kind: "ambiguous",
    earlier: instants[0],
    later: instants[instants.length - 1],
  };
}
