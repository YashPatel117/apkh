"use client";

import { useEffect, useRef } from "react";
import { animate, createTimeline, stagger, steps, utils } from "animejs";
import { FileText, NotebookText, Search, Sparkles } from "lucide-react";
import { emitCosmos } from "@/lib/cosmosBus";
import { prefersReducedMotion } from "@/lib/motion";
import { useT } from "@/i18n";

/**
 * A looping, self-typing AI question: the question is typed, the mind behind
 * the page fires, sources light up and the answer streams in.
 */
export function HeroDemo() {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const question = t("landing.demoQuestion");
  const answer = t("landing.demoAnswer");
  const sources = [
    { Icon: NotebookText, label: t("landing.demoSource1") },
    { Icon: FileText, label: t("landing.demoSource2") },
    { Icon: NotebookText, label: t("landing.demoSource3") },
  ];

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = el.querySelector<HTMLElement>("[data-q]")!;
    const a = el.querySelector<HTMLElement>("[data-a]")!;
    const status = el.querySelector<HTMLElement>("[data-status]")!;
    const chips = el.querySelectorAll<HTMLElement>("[data-chip]");
    const button = el.querySelector<HTMLElement>("[data-ask]")!;
    const caret = el.querySelector<HTMLElement>("[data-caret]")!;

    if (prefersReducedMotion()) {
      q.textContent = question;
      a.textContent = answer;
      utils.set(chips, { opacity: 1 });
      utils.set(status, { opacity: 0 });
      return;
    }

    const typed = { n: 0 };
    const streamed = { n: 0 };
    const blink = animate(caret, { opacity: [1, 0], duration: 530, loop: true, alternate: true, ease: steps(1) });

    const tl = createTimeline({ loop: true, loopDelay: 600 })
      .call(() => {
        q.textContent = "";
        a.textContent = "";
        utils.set(chips, { opacity: 0, y: 10, scale: 0.9 });
        utils.set(status, { opacity: 0 });
        utils.set(a.parentElement!, { opacity: 1 });
      })
      .add(typed, {
        n: [0, question.length],
        duration: question.length * 42,
        ease: "linear",
        onUpdate: () => (q.textContent = question.slice(0, Math.round(typed.n))),
      }, 500)
      .add(button, { scale: [1, 0.9, 1], duration: 380, ease: "outBack" }, "+=250")
      .call(() => emitCosmos("think-start"), "<")
      .add(status, { opacity: [0, 1], duration: 300 }, "<")
      // The status line and the source chips share a row: one leaves before the other arrives.
      .add(status, { opacity: 0, duration: 250 }, "+=900")
      .add(chips, { opacity: [0, 1], y: [10, 0], scale: [0.9, 1], delay: stagger(220), duration: 600, ease: "outBack(1.6)" })
      .add(streamed, {
        n: [0, answer.length],
        duration: answer.length * 22,
        ease: "linear",
        onUpdate: () => (a.textContent = answer.slice(0, Math.round(streamed.n))),
      }, "<")
      .call(() => emitCosmos("think-end"))
      .add(a.parentElement!, { opacity: [1, 0.35], duration: 600 }, "+=3600")
      .add(chips, { opacity: 0, y: -6, delay: stagger(60), duration: 400 }, "<");

    return () => {
      tl.pause();
      blink.pause();
      emitCosmos("think-end");
    };
  }, [question, answer]);

  return (
    <div
      ref={root}
      role="img"
      aria-label={t("landing.demoLabel")}
      className="glass w-full max-w-md rounded-3xl border border-white/40 p-4 shadow-2xl shadow-indigo-900/20 dark:border-white/10"
    >
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface/80 py-1.5 pr-1.5 pl-3">
        <Search className="size-4 shrink-0 text-fg-subtle" />
        <p className="min-w-0 flex-1 truncate text-sm text-fg">
          <span data-q />
          <span data-caret className="ml-px inline-block h-4 w-px translate-y-0.5 bg-accent" />
        </p>
        <span
          data-ask
          className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-linear-to-r from-blue-600 via-indigo-600 to-violet-600 px-3 text-xs font-semibold text-white"
        >
          <Sparkles className="size-3.5" />
          {t("ai.ask")}
        </span>
      </div>

      <div className="relative mt-3 min-h-8">
        <p data-status className="absolute inset-0 flex items-center gap-2 text-xs font-medium text-accent-fg opacity-0">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
          </span>
          {t("landing.demoThinking")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {sources.map(({ Icon, label }, i) => (
            <span
              key={label}
              data-chip
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/60 bg-amber-50/80 px-2.5 py-1 text-[0.7rem] font-medium text-amber-900 opacity-0 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200"
            >
              <span className="font-mono text-[0.62rem] opacity-70">{i + 1}</span>
              <Icon className="size-3" />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-2xl bg-surface-2/70 px-3.5 py-3">
        <p data-a className="min-h-[3.75rem] text-[0.82rem] leading-relaxed text-fg-muted" />
      </div>
    </div>
  );
}
