import { buildQuery, dayRange, dollarsToCents } from "@/lib/adminFormat";
import {
  notificationTarget,
  safeInternalRoute,
} from "@/lib/notificationRouting";

describe("refund amount parsing", () => {
  it("converts dollar text to integer cents", () => {
    expect(dollarsToCents("4.5")).toBe(450);
    expect(dollarsToCents("$12.34")).toBe(1234);
    expect(dollarsToCents(" 7 ")).toBe(700);
    expect(dollarsToCents("0.01")).toBe(1);
    expect(dollarsToCents("0.1")).toBe(10);
  });

  it("rejects anything that is not a positive amount with at most two decimals", () => {
    for (const bad of [
      "",
      "0",
      "0.00",
      "-1",
      "1.234",
      "1e3",
      "abc",
      "1,000",
      "12.",
      "1234567",
    ]) {
      expect(dollarsToCents(bad)).toBeNull();
    }
  });
});

describe("date filters", () => {
  it("turns inclusive days into UTC bounds", () => {
    expect(dayRange("2026-09-01", "2026-09-30")).toEqual({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
    });
  });

  it("ignores incomplete or invalid dates", () => {
    expect(dayRange("2026-09", "")).toEqual({});
    expect(dayRange("", "not-a-date")).toEqual({});
  });

  it("omits empty query values", () => {
    expect(
      buildQuery({
        status: "open",
        rideId: undefined,
        cursor: null,
        limit: 20,
      }),
    ).toBe("?status=open&limit=20");
    expect(buildQuery({})).toBe("");
  });
});

describe("console routing", () => {
  it("lets sign-in return to the console but nothing under it", () => {
    expect(safeInternalRoute("/admin")).toBe("/admin");
    for (const bad of [
      "/admin/../(root)",
      "/admin?x=1",
      "//admin",
      "https://evil.example/admin",
    ]) {
      expect(safeInternalRoute(bad)).toBeNull();
    }
  });

  it("still requires the notification to belong to the signed-in account", () => {
    expect(
      notificationTarget({ target: "/admin", recipient: "user_a" }, "user_b"),
    ).toEqual({
      action: "ignore",
      reason: "other_account",
    });
  });
});
