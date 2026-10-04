export const currencies = ["usd", "all"] as const;
export type Currency = (typeof currencies)[number];

export const paymentMethods = ["card_online", "in_vehicle"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const collectionMethods = ["pos", "cash"] as const;
export type CollectionMethod = (typeof collectionMethods)[number];

export const collectionStatuses = [
  "pending",
  "collected",
  "unpaid",
  "waived",
] as const;
export type CollectionStatus = (typeof collectionStatuses)[number];

const setting = (name: string): string | undefined =>
  typeof process === "undefined" ? undefined : process.env?.[name];

export function appCurrency(): Currency {
  return setting("APP_CURRENCY") === "usd" ? "usd" : "all";
}

export function asCurrency(value: string | null | undefined): Currency {
  return value?.trim() === "all" ? "all" : "usd";
}

export const wholeUnitsOnly = (currency: Currency) => currency === "all";

export function roundUpToUnit(cents: number, currency: Currency) {
  return wholeUnitsOnly(currency) ? Math.ceil(cents / 100) * 100 : cents;
}

export function formatAmount(
  cents: number,
  currency: Currency = appCurrency(),
  locale = "en-US",
): string {
  if (!Number.isSafeInteger(cents)) return "--";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  if (currency === "all") {
    const lek = Math.round(abs / 100);
    let text: string;
    try {
      text = new Intl.NumberFormat(locale, {
        maximumFractionDigits: 0,
      }).format(lek);
    } catch {
      text = String(lek);
    }
    return `${sign}${text} L`;
  }
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}$${whole}.${fraction}`;
}
