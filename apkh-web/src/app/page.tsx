"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  AtSign,
  BookOpenText,
  FileSearch,
  MessagesSquare,
  NotebookPen,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { getValidToken } from "@/services/session";
import { LogoMark, LogoWithText, Wordmark } from "@/components/ui/Logo";
import { ThemeToggle } from "@/components/ui/theme";
import { cn } from "@/lib/cn";
import { MessageKey, useT } from "@/i18n";

const features: { Icon: typeof Sparkles; title: MessageKey; text: MessageKey }[] = [
  { Icon: Sparkles, title: "landing.f1Title", text: "landing.f1Text" },
  { Icon: FileSearch, title: "landing.f2Title", text: "landing.f2Text" },
  { Icon: AtSign, title: "landing.f3Title", text: "landing.f3Text" },
  { Icon: MessagesSquare, title: "landing.f4Title", text: "landing.f4Text" },
  { Icon: BookOpenText, title: "landing.f5Title", text: "landing.f5Text" },
  { Icon: ShieldCheck, title: "landing.f6Title", text: "landing.f6Text" },
];

const steps: { Icon: typeof Sparkles; title: MessageKey; text: MessageKey }[] = [
  { Icon: NotebookPen, title: "landing.s1Title", text: "landing.s1Text" },
  { Icon: FileSearch, title: "landing.s2Title", text: "landing.s2Text" },
  { Icon: Sparkles, title: "landing.s3Title", text: "landing.s3Text" },
];

export default function LandingPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const t = useT();

  useEffect(() => {
    if (getValidToken()) {
      router.replace("/notes");
      return;
    }
    setChecked(true);
  }, [router]);

  return (
    <div className={cn("min-h-dvh transition-opacity duration-300", checked ? "opacity-100" : "opacity-0")}>
      {/* ── Nav ── */}
      <header className="sticky top-0 z-30 border-b border-line/60 bg-canvas/75 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label={t("auth.homeLink")}>
            <LogoMark size={34} />
            <Wordmark />
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Link
              href="/login"
              className="hidden rounded-xl px-4 py-2 text-sm font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg sm:inline-flex"
            >
              {t("auth.signIn")}
            </Link>
            <Link
              href="/register"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-linear-to-r from-blue-600 via-indigo-600 to-violet-600 px-4 text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:brightness-110"
            >
              {t("landing.getStarted")}
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="relative isolate overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(60%_60%_at_20%_10%,rgba(99,102,241,0.18),transparent),radial-gradient(50%_50%_at_85%_20%,rgba(139,92,246,0.16),transparent)]"
          />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:pt-20 lg:pb-28">
            <div className="animate-rise">
              <LogoWithText className="w-56" />
              <h1 className="mt-6 text-4xl leading-[1.08] font-bold tracking-tight text-fg sm:text-5xl lg:text-[3.4rem]">
                {t("landing.title")}{" "}
                <span className="bg-linear-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-indigo-300 dark:to-violet-400">
                  {t("landing.titleAccent")}
                </span>
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">{t("landing.lead")}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-linear-to-r from-blue-600 via-indigo-600 to-violet-600 px-6 font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:brightness-110"
                >
                  {t("landing.startFree")} <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-line bg-surface px-6 font-semibold text-fg shadow-xs transition hover:bg-surface-2"
                >
                  {t("landing.haveAccount")}
                </Link>
              </div>
            </div>

            <div className="relative animate-rise [animation-delay:120ms]">
              <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-linear-to-tr from-blue-500/20 via-indigo-500/15 to-violet-500/20 blur-2xl" />
              <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl shadow-indigo-900/15">
                <Image
                  src="/assets/hero-illustration.jpg"
                  alt={t("landing.heroAlt")}
                  width={1376}
                  height={768}
                  priority
                  sizes="(min-width: 1024px) 600px, 100vw"
                  className="h-auto w-full dark:opacity-90"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="border-y border-line bg-surface/60">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:grid-cols-3 sm:px-6">
            {steps.map(({ Icon, title, text }, i) => (
              <div key={title} className="flex items-start gap-4">
                <span className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <Icon className="size-5" />
                  <span className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600 text-[0.65rem] font-bold text-white">
                    {i + 1}
                  </span>
                </span>
                <div>
                  <h3 className="font-semibold text-fg">{t(title)}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{t(text)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Features ── */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-accent">{t("landing.kicker")}</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-fg sm:text-4xl">{t("landing.featuresTitle")}</h2>
            <p className="mt-3 text-fg-muted">{t("landing.featuresText")}</p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ Icon, title, text }) => (
              <div
                key={title}
                className="group rounded-3xl border border-line bg-surface p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-500/5 dark:hover:border-indigo-400/30"
              >
                <span className="flex size-11 items-center justify-center rounded-2xl bg-linear-to-br from-blue-500/15 via-indigo-500/15 to-violet-500/15 text-accent transition-transform group-hover:scale-105">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 font-semibold text-fg">{t(title)}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{t(text)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="relative overflow-hidden rounded-[2rem] bg-linear-to-br from-blue-600 via-indigo-600 to-violet-700 px-6 py-14 text-center shadow-2xl shadow-indigo-500/25 sm:px-12">
            <div aria-hidden className="absolute -top-24 -left-16 size-72 rounded-full bg-white/10 blur-3xl" />
            <div aria-hidden className="absolute -right-10 -bottom-24 size-72 rounded-full bg-violet-300/20 blur-3xl" />
            <h2 className="relative text-3xl font-bold tracking-tight text-white sm:text-4xl">{t("landing.ctaTitle")}</h2>
            <p className="relative mx-auto mt-3 max-w-lg text-indigo-100">{t("landing.ctaText")}</p>
            <Link
              href="/register"
              className="relative mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 font-semibold text-indigo-700 shadow-lg transition hover:bg-indigo-50"
            >
              {t("landing.ctaButton")} <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      {/* ── Footer (always dark, uses the white logo) ── */}
      <footer className="bg-[#0a1428] text-slate-400">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <div className="flex items-center gap-3">
            <LogoMark size={36} />
            <span className="font-semibold text-white">Knowledge Hub</span>
          </div>
          <p className="text-sm">
            © {new Date().getFullYear()} Knowledge Hub. {t("landing.footer")}
          </p>
        </div>
      </footer>
    </div>
  );
}
