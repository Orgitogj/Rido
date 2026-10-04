import { appCurrency, formatAmount } from "@/shared/currency";

import type { Language } from "@/shared/account";

export interface Tree {
  [key: string]: string | Tree;
}

export type Shape<T> = {
  [K in keyof T]: T[K] extends string ? string : Shape<T[K]>;
};

export function section<T extends Tree>(en: T, sq: Shape<T>) {
  return { en, sq: sq as T };
}

export type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

export type Params = Record<string, string | number>;

export const LOCALES: Record<Language, string> = {
  en: "en-US",
  sq: "sq-AL",
};

export function lookup(tree: Tree, key: string): string | null {
  let node: string | Tree | undefined = tree;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = node[part];
  }
  return typeof node === "string" ? node : null;
}

export function interpolate(template: string, params?: Params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function pluralForm(count: number) {
  return count === 1 ? "one" : "other";
}

export function languageFromLocale(
  locale: string | null | undefined,
): Language {
  return (locale ?? "").toLowerCase().startsWith("sq") ? "sq" : "en";
}

export function formatMoney(
  cents: number,
  language: Language,
  currency: string = appCurrency(),
): string {
  if (!Number.isSafeInteger(cents)) return "--";
  if (currency === "all") return formatAmount(cents, "all", LOCALES[language]);
  try {
    return new Intl.NumberFormat(LOCALES[language], {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")} ${currency.toUpperCase()}`;
  }
}

export function formatDateTime(
  iso: string | null | undefined,
  language: Language,
) {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  try {
    return new Intl.DateTimeFormat(LOCALES[language], {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function formatClockTime(
  iso: string | null | undefined,
  language: Language,
) {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  try {
    return new Intl.DateTimeFormat(LOCALES[language], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
}

export function formatKm(meters: number, language: Language) {
  if (!Number.isFinite(meters)) return "--";
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  try {
    return `${new Intl.NumberFormat(LOCALES[language], {
      maximumFractionDigits: km < 10 ? 1 : 0,
      minimumFractionDigits: km < 10 ? 1 : 0,
    }).format(km)} km`;
  } catch {
    return `${km.toFixed(km < 10 ? 1 : 0)} km`;
  }
}
