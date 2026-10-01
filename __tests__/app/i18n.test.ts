import { checkFile } from "@/lib/driverVerification";
import { tipReasonText } from "@/lib/earningsText";
import {
  formatKm,
  formatMoney,
  interpolate,
  languageFromLocale,
  pluralForm,
  type Tree,
} from "@/lib/i18n/core";
import { sections } from "@/lib/i18n/sections";
import {
  dictionaries,
  errorText,
  translate,
  translateCount,
} from "@/lib/i18n/translate";
import { safeInternalRoute } from "@/lib/notificationRouting";
import { mergeById } from "@/lib/paging";
import { coverageProblem, quoteProblem, secondsUntil } from "@/lib/quoteErrors";
import { formatRating, ratingReasonText, starLabel } from "@/lib/ratingText";
import {
  actionLabel,
  cancellationText,
  paymentNote,
  statusLabel,
} from "@/lib/rideText";
import { rideStatuses } from "@/shared/contracts";
import { tripProblemCode } from "@/shared/geo";

const ID = "3f2c1a54-9b1d-4c7e-8a2f-0d9e6b7c5a41";

function flatten(tree: Tree, prefix = "", out = new Map<string, string>()) {
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") out.set(prefix + key, value);
    else flatten(value, `${prefix}${key}.`, out);
  }
  return out;
}

const placeholders = (text: string) =>
  (text.match(/\{\w+\}/g) ?? []).sort().join(",");

describe("dictionaries", () => {
  it("has the same keys and placeholders in English and Albanian", () => {
    for (const [name, s] of Object.entries(sections)) {
      const en = flatten(s.en as Tree);
      const sq = flatten(s.sq as Tree);
      expect([name, [...sq.keys()].sort()]).toEqual([
        name,
        [...en.keys()].sort(),
      ]);
      for (const [key, value] of en) {
        expect([name, key, placeholders(sq.get(key) ?? "")]).toEqual([
          name,
          key,
          placeholders(value),
        ]);
        expect((sq.get(key) ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("pairs every plural key", () => {
    for (const s of Object.values(sections)) {
      const keys = [...flatten(s.en as Tree).keys()];
      for (const key of keys) {
        if (key.endsWith("_one")) {
          expect(keys).toContain(key.replace(/_one$/, "_other"));
        }
      }
    }
  });

  it("never claims that earnings were paid out", () => {
    for (const language of ["en", "sq"] as const) {
      const earnings = dictionaries[language].driver.earnings;
      expect(earnings.noPayoutsBody.length).toBeGreaterThan(20);
    }
    expect(dictionaries.en.driver.earnings.noPayoutsBody).toMatch(
      /none of it has been paid out/,
    );
    expect(dictionaries.en.safety.emergency).toMatch(
      /does not contact emergency services/,
    );
    expect(dictionaries.sq.safety.emergency).toMatch(/nuk kontakton/);
  });
});

describe("translation helpers", () => {
  it("interpolates and leaves unknown placeholders alone", () => {
    expect(interpolate("Hi {name}", { name: "Ana" })).toBe("Hi Ana");
    expect(interpolate("Hi {name}", {})).toBe("Hi {name}");
    expect(interpolate("{a}{a}", { a: 2 })).toBe("22");
  });

  it("chooses a language from a device locale", () => {
    expect(languageFromLocale("sq-AL")).toBe("sq");
    expect(languageFromLocale("SQ")).toBe("sq");
    expect(languageFromLocale("en-GB")).toBe("en");
    expect(languageFromLocale(null)).toBe("en");
    expect(languageFromLocale("de-DE")).toBe("en");
  });

  it("translates, pluralises and falls back to English", () => {
    expect(translate("en", "common.cancel")).toBe("Cancel");
    expect(translate("sq", "common.cancel")).toBe("Anulo");
    expect(pluralForm(1)).toBe("one");
    expect(pluralForm(0)).toBe("other");
    expect(translateCount("en", "safety.share.views", 1)).toBe("1 view");
    expect(translateCount("en", "safety.share.views", 3)).toBe("3 views");
    expect(translateCount("sq", "safety.share.views", 3)).toBe("3 shikime");
  });

  it("maps server error codes without leaking English into Albanian", () => {
    const quoteExpired = Object.assign(new Error("server text"), {
      code: "QUOTE_EXPIRED",
    });
    const unknown = Object.assign(new Error("server text"), {
      code: "SOMETHING_NEW",
    });
    expect(errorText("en", quoteExpired)).toBe(
      dictionaries.en.errors.QUOTE_EXPIRED,
    );
    expect(errorText("sq", quoteExpired)).toBe(
      dictionaries.sq.errors.QUOTE_EXPIRED,
    );
    expect(errorText("en", unknown)).toBe("server text");
    expect(errorText("sq", unknown)).toBe(dictionaries.sq.errors.generic);
    expect(errorText("sq", unknown, "rezervë")).toBe("rezervë");
    expect(errorText("en", new Error("internal detail"))).toBe(
      dictionaries.en.errors.generic,
    );
    expect(errorText("sq", "NETWORK")).toBe(dictionaries.sq.errors.NETWORK);
    expect(errorText("en", null)).toBe(dictionaries.en.errors.generic);
  });

  it("formats money and distance", () => {
    expect(formatMoney(1250, "en")).toBe("$12.50");
    expect(formatMoney(0, "en")).toBe("$0.00");
    expect(formatMoney(1.5, "en")).toBe("--");
    expect(formatMoney(1250, "sq")).toMatch(/12[.,]50/);
    expect(formatKm(850, "en")).toBe("850 m");
    expect(formatKm(3100, "en")).toBe("3.1 km");
    expect(formatKm(12_400, "en")).toBe("12 km");
    expect(formatKm(Number.NaN, "en")).toBe("--");
  });
});

describe("localized ride wording", () => {
  it("labels every status and action in both languages", () => {
    for (const status of rideStatuses) {
      expect(statusLabel(status, "en")).toBeTruthy();
      expect(statusLabel(status, "sq")).toBeTruthy();
    }
    expect(statusLabel("completed", "sq")).toBe("Përfunduar");
    expect(actionLabel("cancel", "sq")).toBe("Anulo udhëtimin");
  });

  it("explains the payment state in Albanian", () => {
    expect(paymentNote("cancelled", "no_driver", "none", "sq")).toMatch(
      /Nuk u tarifove/,
    );
    expect(paymentNote("authorized", "completed", "retrying", "sq")).toMatch(
      /automatikisht/,
    );
  });

  it("uses the cancellation variant, falling back to the server text", () => {
    const base = {
      title: "Server title",
      consequence: "Server consequence",
      feeCents: 0,
    };
    expect(
      cancellationText(
        { ...base, variant: "passenger_assigned" } as never,
        "$12.50",
        "sq",
      ),
    ).toEqual({
      title: dictionaries.sq.ride.cancel.passenger_assigned_title,
      body: expect.stringContaining("$12.50"),
    });
    expect(cancellationText(base as never, "$12.50", "sq")).toEqual({
      title: "Server title",
      body: "Server consequence",
    });
    expect(dictionaries.en.ride.cancel.passenger_assigned_body).toMatch(
      /no cancellation fee/i,
    );
  });

  it("describes ratings and tips", () => {
    expect(formatRating(null, "sq")).toBe(dictionaries.sq.rating.none);
    expect(formatRating({ count: 1, average: 5 }, "en")).toBe(
      "5.0 ★ · 1 rating",
    );
    expect(formatRating({ count: 12, average: 4.8 }, "sq")).toBe(
      "4.8 ★ · 12 vlerësime",
    );
    expect(ratingReasonText("not_completed", "en")).toBeNull();
    expect(ratingReasonText("window_closed", "sq")).toBeTruthy();
    expect(starLabel(5, "en")).toBe("Excellent");
    expect(starLabel(9, "en")).toBe("Excellent");
    expect(tipReasonText("already_tipped", "en")).toBeNull();
    expect(tipReasonText("payment_pending", "sq")).toBeTruthy();
  });
});

describe("booking helpers", () => {
  it("localizes quote problems and recognises coverage problems", () => {
    expect(quoteProblem("NO_ROUTE", "server", "sq")).toMatchObject({
      code: "NO_ROUTE",
      title: dictionaries.sq.booking.confirm.problemTitle.NO_ROUTE,
      message: dictionaries.sq.errors.NO_ROUTE,
      retry: false,
      changeLocations: true,
    });
    expect(quoteProblem("SOMETHING_NEW", "server", "sq").message).toBe(
      dictionaries.sq.errors.generic,
    );
    expect(coverageProblem("PICKUP_OUTSIDE_SERVICE_AREA")).toBe(true);
    expect(coverageProblem("DESTINATION_OUTSIDE_SERVICE_AREA")).toBe(true);
    expect(coverageProblem("NO_ROUTE")).toBe(false);
    expect(coverageProblem(null)).toBe(false);
  });

  it("counts down to quote expiry and never goes negative", () => {
    const now = new Date("2026-01-01T10:00:00Z").getTime();
    expect(secondsUntil("2026-01-01T10:00:30Z", now)).toBe(30);
    expect(secondsUntil("2026-01-01T10:00:00Z", now)).toBe(0);
    expect(secondsUntil("2026-01-01T09:00:00Z", now)).toBe(0);
    expect(secondsUntil("not a date", now)).toBe(0);
  });

  it("reports trip problems as codes", () => {
    const pickup = { address: "A", latitude: 41.3275, longitude: 19.8187 };
    const destination = { address: "B", latitude: 41.34, longitude: 19.83 };
    const empty = { address: null, latitude: null, longitude: null };
    expect(tripProblemCode(empty, destination)).toBe("PICKUP_MISSING");
    expect(tripProblemCode(pickup, empty)).toBe("DESTINATION_MISSING");
    expect(tripProblemCode(pickup, { ...pickup, address: "C" })).toBe(
      "TOO_CLOSE",
    );
    expect(tripProblemCode({ ...pickup, latitude: 120 }, destination)).toBe(
      "UNRESOLVED",
    );
    expect(tripProblemCode(pickup, destination)).toBeNull();
    for (const code of [
      "PICKUP_MISSING",
      "DESTINATION_MISSING",
      "UNRESOLVED",
      "TOO_CLOSE",
    ] as const) {
      expect(dictionaries.sq.booking.find.problem[code]).toBeTruthy();
    }
  });

  it("merges pages without duplicating rows", () => {
    expect(
      mergeById([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]).map(
        (r) => r.id,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("gives file problems as reasons that both languages explain", () => {
    for (const result of [
      checkFile("photo.heic", "image/heic", 5000),
      checkFile("scan.pdf", null, 20),
      checkFile("scan.pdf", null, 11 * 1024 * 1024),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(dictionaries.sq.driver.documents[result.reason]).toBeTruthy();
      }
    }
  });
});

describe("notification targets added for the inbox", () => {
  it("allows inbox, support and safety routes only in their exact shape", () => {
    expect(safeInternalRoute("/notifications")).toBe("/notifications");
    expect(safeInternalRoute(`/support/${ID}`)).toBe(`/support/${ID}`);
    expect(safeInternalRoute(`/safety/${ID.toUpperCase()}`)).toBe(
      `/safety/${ID}`,
    );
    for (const bad of [
      "/support",
      "/support/1",
      `/support/${ID}/../../admin`,
      `/safety/${ID}?x=1`,
      "/notifications/",
      "/admin/system",
      "/delete-account",
      "https://example.com/notifications",
    ]) {
      expect(safeInternalRoute(bad)).toBeNull();
    }
  });
});
