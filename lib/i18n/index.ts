import * as SecureStore from "expo-secure-store";
import { useMemo } from "react";
import { Platform } from "react-native";
import { create } from "zustand";

import { type Language, languages } from "@/shared/account";

import {
  formatClockTime,
  formatDateTime,
  formatKm,
  formatMoney,
  languageFromLocale,
  type Params,
} from "./core";
import {
  errorText,
  type PluralKey,
  type TKey,
  translate,
  translateCount,
} from "./translate";

export {
  dictionaries,
  errorText,
  type PluralKey,
  type TKey,
  translate,
  translateCount,
} from "./translate";

const STORAGE_KEY = "app.language";

async function readStored(): Promise<Language | null> {
  try {
    const value =
      Platform.OS === "web"
        ? globalThis.localStorage?.getItem(STORAGE_KEY)
        : await SecureStore.getItemAsync(STORAGE_KEY);
    return (languages as readonly string[]).includes(value ?? "")
      ? (value as Language)
      : null;
  } catch {
    return null;
  }
}

async function writeStored(language: Language) {
  try {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(STORAGE_KEY, language);
    } else {
      await SecureStore.setItemAsync(STORAGE_KEY, language);
    }
  } catch {}
}

function deviceLanguage(): Language {
  try {
    return languageFromLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return "en";
  }
}

interface LanguageState {
  language: Language;
  ready: boolean;
  chosen: boolean;
  init: () => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
}

export const useLanguage = create<LanguageState>((set, get) => ({
  language: deviceLanguage(),
  ready: false,
  chosen: false,
  init: async () => {
    if (get().ready) return;
    const stored = await readStored();
    set({
      language: stored ?? deviceLanguage(),
      chosen: stored !== null,
      ready: true,
    });
  },
  setLanguage: async (language) => {
    set({ language, chosen: true, ready: true });
    await writeStored(language);
  },
}));

export function useI18n() {
  const language = useLanguage((s) => s.language);
  return useMemo(
    () => ({
      language,
      t: (key: TKey, params?: Params) => translate(language, key, params),
      tn: (key: PluralKey, count: number, params?: Params) =>
        translateCount(language, key, count, params),
      error: (error: unknown, fallback?: string) =>
        errorText(language, error, fallback),
      queryError: (query: {
        error: string | null;
        errorCode?: string | null;
      }) =>
        errorText(
          language,
          query.errorCode ?? "",
          language === "en" ? (query.error ?? undefined) : undefined,
        ),
      money: (cents: number, currency?: string) =>
        formatMoney(cents, language, currency),
      dateTime: (iso: string | null | undefined) =>
        formatDateTime(iso, language),
      clock: (iso: string | null | undefined) => formatClockTime(iso, language),
      km: (meters: number) => formatKm(meters, language),
      duration: (minutes: number | null | undefined) => {
        if (
          minutes === null ||
          minutes === undefined ||
          Number.isNaN(minutes)
        ) {
          return "--";
        }
        const total = Math.max(1, Math.round(minutes));
        return total < 60
          ? translateCount(language, "common.minutes", total)
          : translate(language, "common.hoursMinutes", {
              hours: Math.floor(total / 60),
              minutes: total % 60,
            });
      },
    }),
    [language],
  );
}

export type I18n = ReturnType<typeof useI18n>;

export function currentLanguage(): Language {
  return useLanguage.getState().language;
}
