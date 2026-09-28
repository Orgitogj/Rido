import { formatRate, periodRange, TIP_STATUS_TEXT } from "@/lib/earningsText";

describe("earnings periods", () => {
  const now = new Date(2026, 8, 27, 15, 30);

  it("starts each period at local midnight and leaves the end open", () => {
    expect(periodRange("all", now)).toEqual({});
    expect(new Date(periodRange("today", now).from!)).toEqual(
      new Date(2026, 8, 27),
    );
    expect(new Date(periodRange("week", now).from!)).toEqual(
      new Date(2026, 8, 21),
    );
    expect(new Date(periodRange("month", now).from!)).toEqual(
      new Date(2026, 7, 29),
    );
  });

  it("formats commission rates from basis points", () => {
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(2000)).toBe("20%");
    expect(formatRate(1250)).toBe("12.50%");
    expect(formatRate(null)).toBe("—");
  });

  it("never describes an unpaid tip as paid", () => {
    for (const status of [
      "creating",
      "pending",
      "requires_action",
      "processing",
      "failed",
      "canceled",
    ] as const) {
      expect(TIP_STATUS_TEXT[status]).not.toMatch(/^Paid/);
    }
    expect(TIP_STATUS_TEXT.succeeded).toBe("Paid");
  });
});
