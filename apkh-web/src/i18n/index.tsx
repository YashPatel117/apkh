"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en, { type MessageKey } from "./messages/en";
import es from "./messages/es";
import hi from "./messages/hi";

export type { MessageKey };

export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
  { id: "hi", label: "हिन्दी" },
] as const;
export type Language = (typeof LANGUAGES)[number]["id"];

const DICTIONARIES: Record<Language, Partial<Record<MessageKey, string>>> = { en, es, hi };
const STORAGE_KEY = "language";

type Vars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: Vars) => string;

/** Fills {name} placeholders; {count} also picks "one|other" plural forms written as {count|one|other}. */
function format(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g, (match, name: string, one?: string, other?: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    if (one !== undefined && other !== undefined) return Number(value) === 1 ? one : other;
    return typeof value === "number" ? value.toLocaleString() : value;
  });
}

function detectLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in DICTIONARIES) return saved as Language;
  } catch {
    // storage unavailable: use the browser's language
  }
  const browser = typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : "en";
  return browser in DICTIONARIES ? (browser as Language) : "en";
}

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}

const translateWith =
  (language: Language): Translate =>
  (key, vars) =>
    format(DICTIONARIES[language][key] ?? en[key] ?? key, vars);

const I18nContext = createContext<I18nContextValue>({
  language: "en",
  setLanguage: () => {},
  t: translateWith("en"),
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // English on the server and first render (no hydration mismatch), then the user's language.
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => setLanguageState(detectLanguage()), []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not remembered, but still applied
    }
  }, []);

  const value = useMemo(() => ({ language, setLanguage, t: translateWith(language) }), [language, setLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
export const useT = () => useContext(I18nContext).t;
