"use client";

import Link from "next/link";
import { FileSearch, MessagesSquare, Sparkles } from "lucide-react";
import { LogoWithText } from "@/components/ui/Logo";
import { ThemeToggle } from "@/components/ui/theme";
import { MessageKey, useT } from "@/i18n";
import { NeuralCosmos } from "@/components/cosmos/NeuralCosmos";
import { SplitReveal } from "@/components/motion/primitives";

const highlights: { Icon: typeof Sparkles; title: MessageKey; text: MessageKey }[] = [
  { Icon: Sparkles, title: "auth.h1Title", text: "auth.h1Text" },
  { Icon: FileSearch, title: "auth.h2Title", text: "auth.h2Text" },
  { Icon: MessagesSquare, title: "auth.h3Title", text: "auth.h3Text" },
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const t = useT();
  return (
    <main className="relative isolate min-h-dvh overflow-hidden">
      {/* The same mind as the landing page, sitting behind the pitch */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_25%_45%,rgba(99,102,241,0.14),transparent),radial-gradient(50%_40%_at_90%_90%,rgba(245,158,11,0.08),transparent)] dark:bg-[radial-gradient(70%_60%_at_25%_45%,rgba(99,102,241,0.22),transparent)]" />
        <NeuralCosmos className="absolute inset-0" offsetX={-2.2} />
      </div>

      <div className="glass absolute top-4 right-4 z-10 rounded-xl border border-line/60">
        <ThemeToggle />
      </div>

      <div className="mx-auto grid min-h-dvh max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-[1.1fr_1fr] lg:px-8">
        <section className="hidden animate-rise lg:block">
          <p className="glass inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs font-semibold text-fg-muted">
            <Sparkles className="size-3.5" /> {t("auth.badge")}
          </p>
          <h2 className="mt-5 max-w-lg text-4xl leading-[1.05] font-bold tracking-tight text-slate-900 xl:text-5xl dark:text-white">
            <SplitReveal text={t("auth.headline")} className="block" delay={120} />
            <span className="block font-display font-normal italic bg-linear-to-r from-sky-500 via-indigo-500 to-amber-500 bg-clip-text text-transparent dark:from-sky-300 dark:via-violet-300 dark:to-amber-300">
              {t("auth.headlineAccent")}
            </span>
          </h2>
          <ul className="mt-10 space-y-3">
            {highlights.map(({ Icon, title, text }) => (
              <li
                key={title}
                className="glass flex max-w-md animate-rise items-start gap-4 rounded-2xl border border-line/60 p-3"
                style={{ animationDelay: `${500 + highlights.findIndex((h) => h.title === title) * 120}ms` }}
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold text-slate-900 dark:text-white">{t(title)}</span>
                  <span className="mt-0.5 block text-sm text-slate-600 dark:text-slate-300">{t(text)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto w-full max-w-md animate-rise">
          <div className="rounded-3xl border border-line/70 bg-surface/85 p-6 shadow-2xl shadow-indigo-900/15 backdrop-blur-xl sm:p-8">
            <Link href="/" className="inline-flex" aria-label={t("auth.homeLink")}>
              <LogoWithText className="w-44" />
            </Link>
            <h1 className="mt-6 text-2xl font-bold tracking-tight text-fg">{title}</h1>
            <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p>
            <div className="mt-7">{children}</div>
          </div>
          <p className="mt-6 text-center text-sm text-slate-700 dark:text-slate-300">{footer}</p>
        </section>
      </div>
    </main>
  );
}

export function FormAlert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: React.ReactNode }) {
  const styles = {
    error: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
    info: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`animate-fade-in rounded-xl border px-3.5 py-2.5 text-sm ${styles[tone]}`}>
      {children}
    </div>
  );
}
