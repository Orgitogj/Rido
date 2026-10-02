import { parseLocalTime } from "@/shared/zonedTime";

export const MAX_STOPS = 2;

export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (
    index < 0 ||
    index >= list.length ||
    target < 0 ||
    target >= list.length
  ) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function addMinutesToLocal(
  local: string,
  minutes: number,
): string | null {
  const parsed = parseLocalTime(local);
  if (!parsed) return null;
  return new Date(parsed.asUtc + minutes * 60_000).toISOString().slice(0, 16);
}

export function nextDayAt(local: string, clock: string): string | null {
  const parsed = parseLocalTime(local);
  if (!parsed || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const tomorrow = new Date(parsed.asUtc + 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  return `${tomorrow}T${clock}`;
}

export function roundUpLocal(
  local: string,
  stepMinutes: number,
): string | null {
  const parsed = parseLocalTime(local);
  if (!parsed || stepMinutes <= 0) return null;
  const step = stepMinutes * 60_000;
  return new Date(Math.ceil(parsed.asUtc / step) * step)
    .toISOString()
    .slice(0, 16);
}

export const splitLocal = (local: string) => ({
  date: local.slice(0, 10),
  time: local.slice(11, 16),
});

export const joinLocal = (date: string, time: string) =>
  `${date.trim()}T${time.trim()}`;

export function repeatedPlace(
  points: { latitude: number; longitude: number }[],
): boolean {
  return points.some(
    (point, index) =>
      index > 0 &&
      Math.abs(point.latitude - points[index - 1].latitude) < 1e-6 &&
      Math.abs(point.longitude - points[index - 1].longitude) < 1e-6,
  );
}

export function nextTarget<P>(ride: {
  stops: P[];
  stopsCompleted: number;
  destination: P;
}): { place: P; stopIndex: number | null } {
  return ride.stopsCompleted < ride.stops.length
    ? { place: ride.stops[ride.stopsCompleted], stopIndex: ride.stopsCompleted }
    : { place: ride.destination, stopIndex: null };
}
