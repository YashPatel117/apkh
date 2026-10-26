"use client";

import { cloneElement, ReactElement, Ref, useEffect, useRef } from "react";
import { animate, splitText, stagger, utils } from "animejs";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * Children marked `data-reveal` rise out of a blur, staggered, the first time
 * the container scrolls into view.
 */
export function useReveal<T extends HTMLElement>({ threshold = 0.18, step = 90 } = {}) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (root.hasAttribute("data-reveal")) items.unshift(root);
    if (prefersReducedMotion()) {
      utils.set(items, { opacity: 1 });
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        animate(items, {
          opacity: [0, 1],
          translateY: [36, 0],
          filter: ["blur(10px)", "blur(0px)"],
          delay: stagger(step),
          duration: 1100,
          ease: "outExpo",
        });
      },
      { threshold },
    );
    io.observe(root);
    return () => io.disconnect();
  }, [threshold, step]);
  return ref;
}

/** Sets --mx / --my on every `.spotlight` card inside, relative to that card. */
export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onMove = (e: PointerEvent) => {
      root.querySelectorAll<HTMLElement>(".spotlight").forEach((card) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - rect.left}px`);
        card.style.setProperty("--my", `${e.clientY - rect.top}px`);
      });
    };
    root.addEventListener("pointermove", onMove);
    return () => root.removeEventListener("pointermove", onMove);
  }, []);
  return ref;
}

/** Leans its child toward the cursor, then springs back. */
export function Magnetic({ children, strength = 0.28 }: { children: ReactElement<{ ref?: Ref<HTMLElement> }>; strength?: number }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || matchMedia("(pointer: coarse)").matches) return;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left - rect.width / 2) * strength;
      const y = (e.clientY - rect.top - rect.height / 2) * strength;
      animate(el, { x, y, duration: 450, ease: "outQuart" });
    };
    const onLeave = () => animate(el, { x: 0, y: 0, duration: 900, ease: "outElastic(1, .45)" });
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [strength]);
  return cloneElement(children, { ref });
}

/** Characters of `text` rise in one by one, from below a mask. */
export function SplitReveal({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = text;
    if (prefersReducedMotion()) return;
    const split = splitText(el, { words: { wrap: "clip" }, chars: true });
    const anim = animate(split.chars, {
      y: ["110%", "0%"],
      rotate: [8, 0],
      opacity: [0, 1],
      delay: stagger(22, { start: delay }),
      duration: 1000,
      ease: "outExpo",
    });
    return () => {
      anim.pause();
      split.revert();
    };
  }, [text, delay]);
  // Keyed by text: splitText rewrites the span's children, so a new text gets a fresh span.
  return (
    <span key={text} ref={ref} className={className}>
      {text}
    </span>
  );
}
