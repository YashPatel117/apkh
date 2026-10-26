"use client";

import { Check, X } from "lucide-react";
import { checkPassword, PasswordContext } from "@/lib/passwordRules";
import { cn } from "@/lib/cn";
import { MessageKey, useT } from "@/i18n";

const STRENGTH: { label: MessageKey; bar: string; text: string }[] = [
  { label: "auth.strength0", bar: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  { label: "auth.strength1", bar: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  { label: "auth.strength2", bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  { label: "auth.strength3", bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  { label: "auth.strength4", bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
];

/** Live rule checklist and strength meter for a new password. */
export function PasswordChecklist({ id, password, context }: { id?: string; password: string; context?: PasswordContext }) {
  const t = useT();
  const { results, strength } = checkPassword(password, context);
  const started = password.length > 0;
  const tone = STRENGTH[strength];

  return (
    <div id={id} className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface-2/50 p-3">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((step) => (
            <span
              key={step}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors duration-300",
                started && strength >= step ? tone.bar : "bg-line",
                started && strength === 0 && step === 1 && tone.bar,
              )}
            />
          ))}
        </div>
        <span aria-live="polite" className={cn("min-w-16 text-right text-xs font-semibold", started ? tone.text : "text-fg-subtle")}>
          {started ? t(tone.label) : t("auth.strengthEmpty")}
        </span>
      </div>
      <ul className="grid gap-x-3 gap-y-1 sm:grid-cols-2" aria-label={t("auth.rulesTitle")}>
        {results.map((rule) => (
          <li
            key={rule.id}
            className={cn(
              "flex items-center gap-1.5 text-xs transition-colors",
              rule.ok ? "text-emerald-700 dark:text-emerald-400" : started ? "text-fg-muted" : "text-fg-subtle",
            )}
          >
            {rule.ok ? <Check className="size-3.5 shrink-0" aria-hidden /> : <X className="size-3.5 shrink-0 opacity-60" aria-hidden />}
            <span>{t(rule.label)}</span>
            <span className="sr-only">{rule.ok ? t("auth.ruleMet") : t("auth.ruleNotMet")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
