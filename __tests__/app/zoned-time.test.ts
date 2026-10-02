import {
  formatInZone,
  parseLocalTime,
  resolveLocalTime,
  zoneOffsetMinutes,
} from "@/shared/zonedTime";

const ZONE = "Europe/Tirane";

describe("local time parsing", () => {
  it("accepts real calendar times only", () => {
    expect(parseLocalTime("2026-03-10T08:15")).toMatchObject({
      year: 2026,
      month: 3,
      day: 10,
      hour: 8,
      minute: 15,
    });
    for (const bad of [
      "2026-02-30T08:00",
      "2026-13-01T08:00",
      "2026-03-10T24:00",
      "2026-03-10T08:60",
      "2026-03-10 08:00",
      "2026-03-10T08:00:00",
      "",
    ]) {
      expect(parseLocalTime(bad)).toBeNull();
    }
  });
});

describe("time zone conversion", () => {
  it("formats an instant in the zone", () => {
    expect(formatInZone(new Date("2026-01-15T11:30:00Z"), ZONE)).toBe(
      "2026-01-15T12:30",
    );
    expect(formatInZone(new Date("2026-07-15T22:30:00Z"), ZONE)).toBe(
      "2026-07-16T00:30",
    );
  });

  it("returns null for an unknown zone", () => {
    expect(formatInZone(new Date("2026-01-15T11:30:00Z"), "Mars/Base")).toBe(
      null,
    );
    expect(
      zoneOffsetMinutes(new Date("2026-01-15T11:30:00Z"), "Mars/Base"),
    ).toBe(null);
    expect(resolveLocalTime("2026-01-15T11:30", "Mars/Base")).toEqual({
      kind: "invalid",
    });
  });

  it("reports winter and summer offsets", () => {
    expect(zoneOffsetMinutes(new Date("2026-01-15T11:30:00Z"), ZONE)).toBe(60);
    expect(zoneOffsetMinutes(new Date("2026-07-15T11:30:00Z"), ZONE)).toBe(120);
  });

  it("resolves an ordinary local time to one instant", () => {
    const winter = resolveLocalTime("2026-01-15T12:30", ZONE);
    expect(winter).toEqual({
      kind: "ok",
      instant: new Date("2026-01-15T11:30:00Z"),
    });
    const summer = resolveLocalTime("2026-07-15T12:30", ZONE);
    expect(summer).toEqual({
      kind: "ok",
      instant: new Date("2026-07-15T10:30:00Z"),
    });
  });

  it("reports a time skipped when clocks go forward", () => {
    expect(resolveLocalTime("2026-03-29T02:30", ZONE)).toEqual({
      kind: "nonexistent",
    });
    expect(resolveLocalTime("2026-03-29T03:00", ZONE)).toEqual({
      kind: "ok",
      instant: new Date("2026-03-29T01:00:00Z"),
    });
  });

  it("reports both instants when clocks go back", () => {
    expect(resolveLocalTime("2026-10-25T02:30", ZONE)).toEqual({
      kind: "ambiguous",
      earlier: new Date("2026-10-25T00:30:00Z"),
      later: new Date("2026-10-25T01:30:00Z"),
    });
  });

  it("rejects malformed input", () => {
    expect(resolveLocalTime("tomorrow", ZONE)).toEqual({ kind: "invalid" });
  });
});
