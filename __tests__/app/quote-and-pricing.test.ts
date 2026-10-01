import {
  parseEffectiveFrom,
  parseRate,
  POLICY_STATE_LABEL,
} from "@/lib/pricingAdmin";
import {
  formatDistance,
  priceHeldUntil,
  quoteProblem,
} from "@/lib/quoteErrors";

describe("quote problems", () => {
  it("offers a retry only for temporary problems", () => {
    expect(quoteProblem("ROUTING_UNAVAILABLE", "m")).toMatchObject({
      retry: true,
      changeLocations: false,
    });
    expect(quoteProblem("NO_ROUTE", "m")).toMatchObject({
      retry: false,
      changeLocations: true,
    });
    expect(quoteProblem("PICKUP_OUTSIDE_SERVICE_AREA", "m").title).toMatch(
      /outside our service area/,
    );
    expect(quoteProblem("PRICING_NOT_CONFIGURED", "m")).toMatchObject({
      retry: false,
      changeLocations: false,
    });
    expect(quoteProblem("SOMETHING_NEW", "server says")).toEqual({
      code: "SOMETHING_NEW",
      title: "Couldn't get a price",
      message: "server says",
      retry: true,
      changeLocations: false,
    });
  });

  it("formats distances and the remaining hold time", () => {
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(3100)).toBe("3.1 km");
    expect(formatDistance(12_400)).toBe("12 km");
    const now = new Date("2026-01-01T10:00:00Z");
    expect(priceHeldUntil("2026-01-01T10:09:59Z", now)).toBe(9);
    expect(priceHeldUntil("2026-01-01T09:59:00Z", now)).toBe(0);
  });
});

describe("console pricing input", () => {
  it("parses rates in dollars to whole cents, allowing zero", () => {
    expect(parseRate("1.2")).toBe(120);
    expect(parseRate("$0")).toBe(0);
    expect(parseRate("0.30")).toBe(30);
    expect(parseRate("1.234")).toBeNull();
    expect(parseRate("-1")).toBeNull();
    expect(parseRate("abc")).toBeNull();
  });

  it("parses effective dates in local time and rejects impossible ones", () => {
    const now = new Date("2026-05-01T12:00:00Z");
    expect(parseEffectiveFrom("now", now)).toBe(now.toISOString());
    const iso = parseEffectiveFrom("2027-01-31 08:00");
    expect(iso).not.toBeNull();
    const d = new Date(iso!);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([
      2027, 0, 31, 8,
    ]);
    expect(parseEffectiveFrom("2027-02-30 08:00")).toBeNull();
    expect(parseEffectiveFrom("tomorrow")).toBeNull();
    expect(Object.keys(POLICY_STATE_LABEL)).toHaveLength(4);
  });
});
