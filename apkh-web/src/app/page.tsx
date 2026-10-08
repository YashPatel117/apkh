"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { animate, scrambleText } from "animejs";
import { ArrowRight, MousePointerClick, Orbit, Sparkles, Waypoints, ZoomIn } from "lucide-react";
import { getValidToken } from "@/services/session";
import { LogoMark, Wordmark } from "@/components/ui/Logo";
import { ThemeToggle } from "@/components/ui/theme";
import { NeuralCosmos } from "@/components/cosmos/NeuralCosmos";
import { HeroDemo } from "@/components/landing/HeroDemo";
import { Pipeline } from "@/components/landing/Pipeline";
import { Bento } from "@/components/landing/Bento";
import { Magnetic, SplitReveal, useReveal } from "@/components/motion/primitives";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { MessageKey, useT } from "@/i18n";

const ROTATING: MessageKey[] = ["landing.rotate1", "landing.rotate2", "landing.rotate3"];

/** The accent phrase decodes itself into the next one every few seconds. */
function RotatingAccent() {
  const t = useT();
  const ref = useRef<HTMLSpanElement>(null);
  const words = ROTATING.map((key) => t(key));
  const joined = words.join("|");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const list = joined.split("|");
    el.textContent = list[0];
    if (prefersReducedMotion()) return;
    let i = 0;
    let anim: ReturnType<typeof animate> | undefined;
    const timer = setInterval(() => {
      i = (i + 1) % list.length;
      anim = animate(el, { innerHTML: scrambleText({ text: list[i], chars: "lowercase", cursor: "▌", perturbation: 0.3 }), duration: 1100 });
    }, 3600);
    return () => {
      clearInterval(timer);
      anim?.pause();
    };
  }, [joined]);

  return (
    <span className="relative block">
      {/* Longest phrase reserves the line so the layout never jumps */}
      <span aria-hidden className="invisible block font-display italic sm:whitespace-nowrap">
        {words.reduce((a, b) => (b.length > a.length ? b : a))}
      </span>
      <span
        key={joined}
        ref={ref}
        className="absolute inset-0 block font-display sm:whitespace-nowrap font-normal italic bg-linear-to-r from-sky-500 via-indigo-500 to-amber-500 bg-clip-text text-transparent dark:from-sky-300 dark:via-violet-300 dark:to-amber-300"
      >
        {words[0]}
      </span>
    </span>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const t = useT();
  const skyRef = useReveal<HTMLDivElement>();
  const ctaRef = useReveal<HTMLDivElement>();

  useEffect(() => {
    if (getValidToken()) {
      router.replace("/notes");
      return;
    }
    setChecked(true);
  }, [router]);

  return (
    <div className={cn("relative min-h-dvh overflow-x-clip transition-opacity duration-500", checked ? "opacity-100" : "opacity-0")}>
      {/* ── The mind: fixed behind every section, unwinds into a galaxy on scroll ── */}
      <div aria-hidden className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_70%_40%,rgba(99,102,241,0.12),transparent),radial-gradient(60%_50%_at_10%_90%,rgba(245,158,11,0.08),transparent)] dark:bg-[radial-gradient(80%_60%_at_70%_40%,rgba(99,102,241,0.2),transparent),radial-gradient(60%_50%_at_10%_90%,rgba(245,158,11,0.08),transparent)]" />
        {checked && <NeuralCosmos className="absolute inset-0" scrollMorph shockOnClick offsetX={1.7} />}
      </div>

      {/* ── Nav ── */}
      <header className="sticky top-0 z-30 px-3 pt-3">
        <nav className="glass mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 rounded-2xl border border-line/60 px-3 sm:px-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label={t("auth.homeLink")}>
            <LogoMark size={32} />
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
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-fg px-4 text-sm font-semibold text-canvas transition hover:opacity-90"
            >
              {t("landing.getStarted")}
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="mx-auto grid min-h-[calc(100dvh-4.5rem)] grid-cols-1 max-w-6xl items-center gap-10 px-4 pt-10 pb-16 sm:px-6 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="glass inline-flex animate-rise items-center gap-2 rounded-full border border-line px-3 py-1 text-xs font-semibold text-fg-muted">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
              </span>
              {t("landing.kickerLive")}
            </p>
            <h1 className="mt-6 text-[2.6rem] leading-[1.02] font-bold tracking-tight text-fg sm:text-6xl lg:text-[4.3rem]">
              {checked && <SplitReveal text={t("landing.title")} className="block" delay={150} />}
              {checked && <RotatingAccent />}
            </h1>
            <p className="mt-6 max-w-xl animate-rise text-lg leading-relaxed text-fg-muted [animation-delay:500ms]">{t("landing.lead")}</p>
            <div className="mt-9 flex animate-rise flex-col gap-3 [animation-delay:650ms] sm:flex-row sm:items-center">
              <Magnetic>
                <Link
                  href="/register"
                  className="group inline-flex h-13 items-center justify-center gap-2 rounded-2xl bg-linear-to-r from-blue-600 via-indigo-600 to-violet-600 px-7 font-semibold text-white shadow-xl shadow-indigo-500/30 transition hover:brightness-110"
                >
                  {t("landing.startFree")}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Magnetic>
              <Link
                href="/login"
                className="glass inline-flex h-13 items-center justify-center rounded-2xl border border-line px-6 font-semibold text-fg transition hover:bg-surface"
              >
                {t("landing.haveAccount")}
              </Link>
            </div>
            <p className="mt-8 hidden animate-rise items-center gap-2 text-xs text-fg-subtle [animation-delay:900ms] sm:inline-flex">
              <MousePointerClick className="size-3.5" />
              {t("landing.clickHint")}
            </p>
          </div>

          <div className="flex animate-rise justify-center [animation-delay:900ms] lg:justify-end lg:self-end lg:pb-6">
            <HeroDemo />
          </div>
        </section>

        <Pipeline />

        {/* ── Constellation: the galaxy behind the page is the illustration ── */}
        <section className="mx-auto flex min-h-[85vh] max-w-6xl items-center px-4 py-24 sm:px-6">
          <div ref={skyRef} className="glass max-w-lg rounded-[2rem] border border-line p-8 shadow-2xl shadow-indigo-900/10">
            <p data-reveal className="inline-flex items-center gap-2 font-mono text-xs font-semibold tracking-[0.2em] text-accent uppercase">
              <Orbit className="size-4" />
              {t("landing.skyKicker")}
            </p>
            <h2 data-reveal className="mt-4 text-4xl leading-tight font-bold tracking-tight text-fg sm:text-5xl">
              {t("landing.skyTitle")}
            </h2>
            <p data-reveal className="mt-4 leading-relaxed text-fg-muted">
              {t("landing.skyText")}
            </p>
            <ul className="mt-6 space-y-3">
              {[
                { Icon: ZoomIn, key: "landing.sky1" as const },
                { Icon: Waypoints, key: "landing.sky2" as const },
                { Icon: Sparkles, key: "landing.sky3" as const },
              ].map(({ Icon, key }) => (
                <li data-reveal key={key} className="flex items-center gap-3 text-sm text-fg">
                  <span className="flex size-8 items-center justify-center rounded-xl bg-amber-400/15 text-amber-600 dark:text-amber-300">
                    <Icon className="size-4" />
                  </span>
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <Bento />

        {/* ── CTA ── */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div
            ref={ctaRef}
            data-reveal
            className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-[#070b1a] px-6 py-16 text-center shadow-2xl shadow-indigo-900/30 sm:px-12"
          >
            <div aria-hidden className="absolute -top-32 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-indigo-600/30 blur-3xl" />
            <div aria-hidden className="absolute -right-20 -bottom-32 size-80 rounded-full bg-amber-500/20 blur-3xl" />
            <div
              aria-hidden
              className="absolute inset-0 opacity-40 [background-image:radial-gradient(rgba(255,255,255,0.7)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(60%_60%_at_50%_50%,#000,transparent)]"
            />
            <h2 className="relative text-4xl font-bold tracking-tight text-white sm:text-6xl">
              {t("landing.ctaTitle").replace(/[.。।]$/, "")}
              <span className="font-display font-normal italic text-amber-300">.</span>
            </h2>
            <p className="relative mx-auto mt-4 max-w-lg text-indigo-100/80">{t("landing.ctaText")}</p>
            <Magnetic>
              <Link
                href="/register"
                className="relative mt-9 inline-flex h-13 items-center gap-2 rounded-2xl bg-white px-7 font-semibold text-indigo-950 shadow-lg shadow-white/10 transition hover:bg-amber-50"
              >
                {t("landing.ctaButton")} <ArrowRight className="size-4" />
              </Link>
            </Magnetic>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/60 glass">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <div className="flex items-center gap-3">
            <LogoMark size={32} />
            <span className="font-semibold text-fg">Knowledge Hub</span>
          </div>
          <p className="text-sm text-fg-subtle">
            © {new Date().getFullYear()} Knowledge Hub. {t("landing.footer")}
          </p>
        </div>
      </footer>
    </div>
  );
}
