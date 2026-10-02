import {
  addMinutesToLocal,
  joinLocal,
  MAX_STOPS,
  moveItem,
  nextDayAt,
  nextTarget,
  repeatedPlace,
  roundUpLocal,
  splitLocal,
} from "@/lib/itinerary";
import { safeInternalRoute } from "@/lib/notificationRouting";

const SCHEDULED = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("itinerary helpers", () => {
  it("allows two intermediate stops", () => {
    expect(MAX_STOPS).toBe(2);
  });

  it("reorders stops without mutating the list", () => {
    const stops = ["a", "b"];
    expect(moveItem(stops, 0, 1)).toEqual(["b", "a"]);
    expect(moveItem(stops, 1, -1)).toEqual(["b", "a"]);
    expect(stops).toEqual(["a", "b"]);
  });

  it("ignores moves outside the list", () => {
    const stops = ["a", "b"];
    expect(moveItem(stops, 0, -1)).toBe(stops);
    expect(moveItem(stops, 1, 1)).toBe(stops);
    expect(moveItem(stops, 5, -1)).toBe(stops);
  });

  it("detects the same place twice in a row", () => {
    const a = { latitude: 41.3275, longitude: 19.8187 };
    const b = { latitude: 41.3301, longitude: 19.8302 };
    expect(repeatedPlace([a, b, a])).toBe(false);
    expect(repeatedPlace([a, a, b])).toBe(true);
    expect(repeatedPlace([a, b, { ...b }])).toBe(true);
  });

  it("targets stops in order and then the destination", () => {
    const ride = { stops: ["s1", "s2"], destination: "end" };
    expect(nextTarget({ ...ride, stopsCompleted: 0 })).toEqual({
      place: "s1",
      stopIndex: 0,
    });
    expect(nextTarget({ ...ride, stopsCompleted: 1 })).toEqual({
      place: "s2",
      stopIndex: 1,
    });
    expect(nextTarget({ ...ride, stopsCompleted: 2 })).toEqual({
      place: "end",
      stopIndex: null,
    });
    expect(
      nextTarget({ stops: [], stopsCompleted: 0, destination: "end" }),
    ).toEqual({ place: "end", stopIndex: null });
  });
});

describe("local schedule times", () => {
  it("adds minutes across midnight and month ends", () => {
    expect(addMinutesToLocal("2026-01-31T23:30", 60)).toBe("2026-02-01T00:30");
    expect(addMinutesToLocal("2026-03-10T08:00", 120)).toBe("2026-03-10T10:00");
    expect(addMinutesToLocal("not a time", 60)).toBeNull();
  });

  it("rounds up to the next step and keeps exact steps", () => {
    expect(roundUpLocal("2026-03-10T08:01", 15)).toBe("2026-03-10T08:15");
    expect(roundUpLocal("2026-03-10T08:15", 15)).toBe("2026-03-10T08:15");
    expect(roundUpLocal("2026-03-10T23:58", 5)).toBe("2026-03-11T00:00");
    expect(roundUpLocal("2026-03-10T08:01", 0)).toBeNull();
  });

  it("builds a time on the following day", () => {
    expect(nextDayAt("2026-12-31T22:10", "08:00")).toBe("2027-01-01T08:00");
    expect(nextDayAt("2026-12-31T22:10", "25:00")).toBeNull();
    expect(nextDayAt("bad", "08:00")).toBeNull();
  });

  it("splits and joins date and time fields", () => {
    expect(splitLocal("2026-03-10T08:15")).toEqual({
      date: "2026-03-10",
      time: "08:15",
    });
    expect(joinLocal(" 2026-03-10 ", " 08:15 ")).toBe("2026-03-10T08:15");
  });
});

describe("scheduled request routes", () => {
  it("opens a scheduled request from a notification", () => {
    expect(safeInternalRoute(`/scheduled/${SCHEDULED}`)).toBe(
      `/scheduled/${SCHEDULED}`,
    );
    expect(safeInternalRoute(`/scheduled/${SCHEDULED.toUpperCase()}`)).toBe(
      `/scheduled/${SCHEDULED}`,
    );
  });

  it("rejects malformed scheduled routes", () => {
    for (const bad of [
      "/scheduled",
      "/scheduled/",
      "/scheduled/123",
      `/scheduled/${SCHEDULED}/quote`,
      `/scheduled/${SCHEDULED}?next=/admin`,
      `//scheduled/${SCHEDULED}`,
    ]) {
      expect(safeInternalRoute(bad)).toBeNull();
    }
  });
});
