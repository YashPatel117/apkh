"use client";

import { Check, Languages } from "lucide-react";
import { LANGUAGES, useI18n } from "@/i18n";
import { cn } from "@/lib/cn";

/** The app's language (menus and messages; remembered in this browser). */
export default function LanguageCard() {
  const { language, setLanguage, t } = useI18n();
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Languages className="size-[1.1rem]" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-fg">{t("language.title")}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">{t("language.hint")}</p>
        </div>
      </div>
      <div role="radiogroup" aria-label={t("language.title")} className="mt-4 grid grid-cols-3 gap-2">
        {LANGUAGES.map((option) => {
          const selected = language === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              lang={option.id}
              onClick={() => setLanguage(option.id)}
              className={cn(
                "flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-colors",
                selected ? "border-accent bg-accent-soft text-accent-fg" : "border-line text-fg-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              {selected && <Check className="size-3.5" />}
              {option.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
