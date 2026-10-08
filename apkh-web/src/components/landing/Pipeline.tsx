"use client";

import { useEffect, useRef } from "react";
import { animate, createDrawable, createTimeline, stagger, svg, utils } from "animejs";
import { FileSearch, NotebookPen, Sparkles } from "lucide-react";
import { prefersReducedMotion } from "@/lib/motion";
import { MessageKey, useT } from "@/i18n";

const steps: { Icon: typeof Sparkles; title: MessageKey; text: MessageKey }[] = [
  { Icon: NotebookPen, title: "landing.s1Title", text: "landing.s1Text" },
  { Icon: FileSearch, title: "landing.s2Title", text: "landing.s2Text" },
  { Icon: Sparkles, title: "landing.s3Title", text: "landing.s3Text" },
];

// Three stations on one wave; the cards sit under x = 200 / 600 / 1000.
const PATH = "M 40 90 C 120 90, 140 40, 200 40 S 320 140, 400 90 S 520 40, 600 40 S 720 140, 800 90 S 920 40, 1000 40 S 1120 90, 1160 90";
const STATIONS = [200, 600, 1000];

export function Pipeline() {
  const t = useT();
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const path = el.querySelector<SVGPathElement>("[data-path]")!;
    const stations = el.querySelectorAll<SVGElement>("[data-station]");
    const cards = el.querySelectorAll<HTMLElement>("[data-step]");
    const heading = el.querySelectorAll<HTMLElement>("[data-head]");
    const signal = el.querySelector<SVGGElement>("[data-signal]")!;

    if (prefersReducedMotion()) {
      utils.set([...cards, ...heading], { opacity: 1 });
      return;
    }
    const [drawable] = createDrawable(path);
    utils.set(drawable, { draw: "0 0" });
    utils.set(stations, { scale: 0, transformOrigin: "50% 50%" });
    utils.set(signal, { opacity: 0 });

    let travel: ReturnType<typeof animate> | undefined;
    const tl = createTimeline({ autoplay: false })
      .add(heading, { opacity: [0, 1], y: [24, 0], delay: stagger(90), duration: 900, ease: "outExpo" })
      .add(drawable, { draw: ["0 0", "0 1"], duration: 1800, ease: "inOutQuad" }, "<<+=200")
      .add(stations, { scale: [0, 1], delay: stagger(520), duration: 700, ease: "outBack(2.2)" }, "<<+=250")
      .add(cards, { opacity: [0, 1], y: [40, 0], filter: ["blur(8px)", "blur(0px)"], delay: stagger(520), duration: 1000, ease: "outExpo" }, "<<")
      .call(() => {
        utils.set(signal, { opacity: 1 });
        travel = animate(signal, { ...svg.createMotionPath(path), duration: 5200, loop: true, ease: "inOutSine" });
      });

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        tl.play();
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      tl.pause();
      travel?.pause();
    };
  }, []);

  return (
    <section ref={root} className="relative mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <div className="max-w-2xl">
        <p data-head data-reveal className="font-mono text-xs font-semibold tracking-[0.2em] text-accent uppercase">
          {t("landing.pipelineKicker")}
        </p>
        <h2 data-head data-reveal className="mt-3 text-3xl font-bold tracking-tight text-fg sm:text-5xl">
          {t("landing.pipelineTitle")}
        </h2>
      </div>

      <div className="relative mt-14">
        <svg viewBox="0 0 1200 130" className="hidden w-full overflow-visible md:block" aria-hidden>
          <defs>
            <linearGradient id="pipe" x1="0" x2="1">
              <stop offset="0" stopColor="#3b82f6" />
              <stop offset="0.5" stopColor="#6366f1" />
              <stop offset="1" stopColor="#f59e0b" />
            </linearGradient>
            <radialGradient id="signal-glow">
              <stop offset="0" stopColor="#fbbf24" stopOpacity="1" />
              <stop offset="1" stopColor="#fbbf24" stopOpacity="0" />
            </radialGradient>
          </defs>
          <path d={PATH} fill="none" stroke="var(--line)" strokeWidth="2" strokeDasharray="2 8" strokeLinecap="round" />
          <path data-path d={PATH} fill="none" stroke="url(#pipe)" strokeWidth="2.5" strokeLinecap="round" />
          {STATIONS.map((x) => (
            <g key={x} data-station style={{ transformBox: "fill-box" }}>
              <circle cx={x} cy={40} r={16} fill="var(--surface)" stroke="url(#pipe)" strokeWidth="2" />
              <circle cx={x} cy={40} r={5} fill="#6366f1" />
            </g>
          ))}
          <g data-signal>
            <circle r={14} fill="url(#signal-glow)" />
            <circle r={4} fill="#fff7d6" />
          </g>
        </svg>

        <ol className="grid gap-4 md:-mt-6 md:grid-cols-3 md:gap-8">
          {steps.map(({ Icon, title, text }, i) => (
            <li
              key={title}
              data-step
              data-reveal
              className="glass relative rounded-3xl border border-line p-6 shadow-xl shadow-indigo-900/5 md:mx-4"
            >
              <span className="font-mono text-xs font-semibold text-fg-subtle">0{i + 1}</span>
              <span className="mt-4 flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-fg">{t(title)}</h3>
              <p className="mt-1 text-sm leading-relaxed text-fg-muted">{t(text)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
