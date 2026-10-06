import { formatMoney } from "@/lib/i18n/core";
import { cancellationText, vehiclePaymentNote } from "@/lib/rideText";
import { formatCents } from "@/shared/contracts";
import {
  appCurrency,
  asCurrency,
  formatAmount,
  roundUpToUnit,
} from "@/shared/currency";

describe("currency", () => {
  const previous = process.env.APP_CURRENCY;
  afterEach(() => {
    process.env.APP_CURRENCY = previous;
  });

  it("uses lek unless the deployment says otherwise", () => {
    delete process.env.APP_CURRENCY;
    expect(appCurrency()).toBe("all");
    process.env.APP_CURRENCY = "usd";
    expect(appCurrency()).toBe("usd");
    process.env.APP_CURRENCY = "eur";
    expect(appCurrency()).toBe("all");
  });

  it("reads stored currency codes", () => {
    expect(asCurrency("all")).toBe("all");
    expect(asCurrency("all ")).toBe("all");
    expect(asCurrency("usd")).toBe("usd");
    expect(asCurrency(null)).toBe("usd");
  });

  it("rounds lek fares up to a whole lek and leaves dollar fares alone", () => {
    expect(roundUpToUnit(44255, "all")).toBe(44300);
    expect(roundUpToUnit(44300, "all")).toBe(44300);
    expect(roundUpToUnit(1, "all")).toBe(100);
    expect(roundUpToUnit(832, "usd")).toBe(832);
  });

  it("shows lek without decimals and dollars with cents", () => {
    expect(formatAmount(44300, "all")).toBe("443 L");
    expect(formatAmount(125000, "all")).toBe("1,250 L");
    expect(formatAmount(-30000, "all")).toBe("-300 L");
    expect(formatAmount(832, "usd")).toBe("$8.32");
    expect(formatAmount(Number.NaN, "all")).toBe("--");
    expect(formatCents(44300, "all")).toBe("443 L");
  });

  it("formats money for both languages", () => {
    expect(formatMoney(125000, "en", "all")).toBe("1,250 L");
    expect(formatMoney(125000, "sq", "all")).toMatch(/^1.?250 L$/);
    expect(formatMoney(832, "en", "usd")).toBe("$8.32");
    delete process.env.APP_CURRENCY;
    expect(formatMoney(44300, "en")).toBe("443 L");
  });
});

describe("payment in the vehicle wording", () => {
  it("tells the passenger what to pay and what was recorded", () => {
    const note = (
      status: "in_progress" | "completed" | "cancelled",
      collection: Parameters<typeof vehiclePaymentNote>[0]["collection"],
    ) => vehiclePaymentNote({ status, collection }, "en");
    const base = { collectedAt: null, canRecord: false };
    expect(note("in_progress", null)).toMatch(/card or cash at the end/);
    expect(note("cancelled", null)).toMatch(/nothing to pay/i);
    expect(
      note("completed", { ...base, status: "pending", method: null }),
    ).toMatch(/updates when the driver records/);
    expect(
      note("completed", { ...base, status: "collected", method: "pos" }),
    ).toMatch(/terminal/);
    expect(
      note("completed", { ...base, status: "collected", method: "cash" }),
    ).toMatch(/cash/);
    expect(
      note("completed", { ...base, status: "unpaid", method: null }),
    ).toMatch(/unpaid/);
    expect(
      vehiclePaymentNote(
        {
          status: "completed",
          collection: { ...base, status: "unpaid", method: null },
        },
        "sq",
      ),
    ).toMatch(/papaguar/);
  });

  it("never mentions a card hold when cancelling a ride paid in the vehicle", () => {
    for (const variant of [
      "passenger_unpaid",
      "passenger_searching",
      "passenger_assigned",
      "driver_rematch",
      "driver_final",
      "driver_interrupt",
    ] as const) {
      for (const language of ["en", "sq"] as const) {
        const text = cancellationText(
          {
            action: variant === "driver_interrupt" ? "interrupt" : "cancel",
            variant,
            title: "",
            consequence: "",
            feeCents: 0,
          },
          "443 L",
          language,
          true,
        );
        expect(text.body).not.toMatch(/hold|bllokim/i);
        expect(text.body.length).toBeGreaterThan(20);
      }
    }
  });
});
