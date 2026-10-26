"use client";

import { AtSign, BookOpenText, FileImage, FileSearch, FileText, MessagesSquare, ShieldCheck, Sparkles } from "lucide-react";
import { useReveal, useSpotlight } from "@/components/motion/primitives";
import { cn } from "@/lib/cn";
import { MessageKey, useT } from "@/i18n";

function Card({
  Icon,
  title,
  text,
  className,
  children,
}: {
  Icon: typeof Sparkles;
  title: MessageKey;
  text: MessageKey;
  className?: string;
  children?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div data-reveal className={cn("spotlight glass flex flex-col rounded-3xl border border-line p-6", className)}>
      <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Icon className="size-5" />
      </span>
      <h3 className="mt-5 font-semibold text-fg">{t(title)}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{t(text)}</p>
      {children}
    </div>
  );
}

export function Bento() {
  const t = useT();
  const reveal = useReveal<HTMLDivElement>({ step: 70 });
  const spotlight = useSpotlight<HTMLDivElement>();

  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <div className="max-w-2xl">
        <p className="font-mono text-xs font-semibold tracking-[0.2em] text-accent uppercase">{t("landing.kicker")}</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-fg sm:text-5xl">{t("landing.featuresTitle")}</h2>
        <p className="mt-4 text-fg-muted">{t("landing.featuresText")}</p>
      </div>

      <div
        ref={(el) => {
          reveal.current = el;
          spotlight.current = el;
        }}
        className="spotlight-group mt-12 grid gap-4 md:grid-cols-3"
      >
        {/* Answers with receipts — a citation lighting up its passage */}
        <Card Icon={Sparkles} title="landing.f1Title" text="landing.f1Text" className="md:col-span-2 md:row-span-2">
          <div className="mt-6 flex-1 rounded-2xl border border-line bg-surface/70 p-4 text-sm leading-relaxed text-fg-muted">
            <p>
              Launch moved to <mark className="rounded bg-amber-200/70 px-1 text-fg dark:bg-amber-400/25">the second week of May</mark>
              <sup className="ml-0.5 font-mono text-[0.65rem] font-bold text-amber-600 dark:text-amber-300">[1]</sup>, once the
              onboarding flow passes review
              <sup className="ml-0.5 font-mono text-[0.65rem] font-bold text-accent">[2]</sup>.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-amber-300/50 bg-amber-50/70 p-3 dark:border-amber-400/20 dark:bg-amber-400/5">
                <p className="font-mono text-[0.65rem] font-bold text-amber-700 dark:text-amber-300">[1] Roadmap 2026</p>
                <p className="mt-1 text-xs">“…we push launch to the second week of May so QA has room…”</p>
              </div>
              <div className="rounded-xl border border-line bg-surface-2/60 p-3">
                <p className="font-mono text-[0.65rem] font-bold text-accent">[2] Design review.pdf · p.2</p>
                <p className="mt-1 text-xs">“Onboarding needs one more pass before sign-off.”</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-fg-subtle">{t("landing.bentoCite")}</p>
          </div>
        </Card>

        {/* Reads your attachments — files under a scanning light */}
        <Card Icon={FileSearch} title="landing.f2Title" text="landing.f2Text">
          <div className="relative mt-5 flex h-20 items-end gap-2 overflow-hidden">
            {[FileText, FileImage, FileText].map((Icon, i) => (
              <span
                key={i}
                className="flex h-16 flex-1 items-center justify-center rounded-xl border border-line bg-surface-2/70 text-fg-subtle"
                style={{ height: `${56 + i * 6}px` }}
              >
                <Icon className="size-5" />
              </span>
            ))}
            <span className="animate-scan absolute inset-x-0 top-0 h-1.5 rounded-full bg-linear-to-r from-transparent via-amber-400 to-transparent blur-[1px]" />
          </div>
        </Card>

        {/* Scope with @mentions */}
        <Card Icon={AtSign} title="landing.f3Title" text="landing.f3Text">
          <div className="mt-5 flex items-center gap-1.5 rounded-xl border border-line bg-surface/70 px-3 py-2 text-sm text-fg-muted">
            {t("landing.bentoMention")}
            <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent-fg">
              <AtSign className="size-3" />
              Roadmap 2026
            </span>
            <span className="h-4 w-px animate-pulse bg-accent" />
          </div>
        </Card>

        <Card Icon={MessagesSquare} title="landing.f4Title" text="landing.f4Text" />
        <Card Icon={BookOpenText} title="landing.f5Title" text="landing.f5Text" />
        <Card Icon={ShieldCheck} title="landing.f6Title" text="landing.f6Text">
          <div className="mt-5 flex flex-wrap gap-1.5">
            {["Gemini", "OpenAI", "Claude", "OpenRouter"].map((name) => (
              <span key={name} className="rounded-full border border-line bg-surface-2/70 px-2.5 py-1 font-mono text-[0.68rem] text-fg-muted">
                {name}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}
