"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "./cn";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

/** Runs before hydration (inlined in <head>) so there's no light→dark flash. */
export const themeInitScript = `(function(){try{var p=localStorage.getItem("${STORAGE_KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (p: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  preference: "system",
  resolved: "light",
  setPreference: () => {},
});

export const useTheme = () => useContext(ThemeContext);

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

/**
 * Flips the `dark` class in one step. Every element's own colour transition is
 * suppressed (see `.theme-switching` in globals.css) so nothing animates at its own
 * speed while background images swap instantly; where supported, the whole page
 * cross-fades as a single snapshot instead.
 */
// View-transition callbacks run asynchronously, so a queued flip must read the
// *latest* requested theme rather than the one captured when it was queued.
let targetDark = false;
let flipQueued = false;

function applyTheme(dark: boolean, animate: boolean) {
  targetDark = dark;
  if (flipQueued) return; // the queued flip will pick up targetDark
  const root = document.documentElement;
  if (root.classList.contains("dark") === dark) return;

  const flip = () => {
    flipQueued = false;
    if (root.classList.contains("dark") === targetDark) return;
    root.classList.add("theme-switching");
    root.classList.toggle("dark", targetDark);
    void root.offsetHeight; // commit the new styles while transitions are off
    requestAnimationFrame(() => root.classList.remove("theme-switching"));
  };

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (animate && !reducedMotion && typeof doc.startViewTransition === "function") {
    flipQueued = true;
    doc.startViewTransition(flip);
  } else {
    flip();
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // null until the stored preference is read — applying the "system" default first
  // would briefly override the class the <head> script already set.
  const [preference, setPref] = useState<ThemePreference | null>(null);
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  const animateNext = useRef(false);

  useEffect(() => {
    setPref(readPreference());
  }, []);

  useEffect(() => {
    if (!preference) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = (animate: boolean) => {
      const dark = preference === "dark" || (preference === "system" && media.matches);
      applyTheme(dark, animate);
      setResolved(dark ? "dark" : "light");
    };
    apply(animateNext.current); // only user-initiated changes animate, never page load
    animateNext.current = false;
    const onOsChange = () => apply(true);
    media.addEventListener("change", onOsChange);
    return () => media.removeEventListener("change", onOsChange);
  }, [preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    animateNext.current = true;
    setPref(p);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {}
  }, []);

  return (
    <ThemeContext.Provider value={{ preference: preference ?? "system", resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

const options: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/** The app's single appearance control. Each click cycles Light → Dark → System;
 *  the icon shows the current mode. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const index = Math.max(0, options.findIndex((o) => o.value === preference));
  const current = options[index];
  const next = options[(index + 1) % options.length];

  return (
    <button
      type="button"
      onClick={() => setPreference(next.value)}
      aria-label={`Theme: ${current.label}. Switch to ${next.label}`}
      title={`Theme: ${current.label} — click for ${next.label}`}
      className={cn(
        "flex size-10 cursor-pointer items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
        className,
      )}
    >
      <current.Icon key={current.value} className="size-[1.15rem] animate-scale-in" />
    </button>
  );
}
