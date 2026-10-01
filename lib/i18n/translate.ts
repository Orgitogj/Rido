import {
  interpolate,
  lookup,
  type Params,
  type Paths,
  pluralForm,
  type Tree,
} from "./core";
import { sections } from "./sections";

import type { Language } from "@/shared/account";

type SectionName = keyof typeof sections;
type English = { [K in SectionName]: (typeof sections)[K]["en"] };

const build = (language: Language) =>
  Object.fromEntries(
    Object.entries(sections).map(([name, s]) => [name, s[language]]),
  ) as unknown as English;

export const dictionaries: Record<Language, English> = {
  en: build("en"),
  sq: build("sq"),
};

export type TKey = Paths<English>;

export function translate(
  language: Language,
  key: TKey,
  params?: Params,
): string {
  const template =
    lookup(dictionaries[language] as unknown as Tree, key) ??
    lookup(dictionaries.en as unknown as Tree, key) ??
    key;
  return interpolate(template, params);
}

type PluralBase<K> = K extends `${infer B}_one` ? B : never;
export type PluralKey = PluralBase<TKey>;

export function translateCount(
  language: Language,
  key: PluralKey,
  count: number,
  params?: Params,
) {
  return translate(language, `${key}_${pluralForm(count)}` as TKey, {
    count,
    ...params,
  });
}

function codeOf(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

export function errorText(
  language: Language,
  error: unknown,
  fallback?: string,
): string {
  const code = codeOf(error);
  if (code) {
    const known = lookup(
      dictionaries[language].errors as unknown as Tree,
      code,
    );
    if (known) return known;
  }
  if (fallback) return fallback;
  if (
    language === "en" &&
    error instanceof Error &&
    codeOf(error) !== null &&
    error.message
  ) {
    return error.message;
  }
  return dictionaries[language].errors.generic;
}
