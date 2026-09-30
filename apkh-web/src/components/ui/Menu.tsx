"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface MenuProps {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  side?: "bottom" | "top";
  className?: string;
}

/** Dropdown that closes on outside click, Escape, or item selection. */
export function Menu({ trigger, children, align = "right", side = "bottom", className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-40 min-w-52 animate-scale-in rounded-2xl border border-line bg-surface p-1.5 shadow-xl shadow-slate-900/10",
            align === "right" ? "right-0" : "left-0",
            side === "bottom" ? "top-full mt-2 origin-top" : "bottom-full mb-2 origin-bottom",
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  danger,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors [&>svg]:size-4 [&>svg]:shrink-0",
        danger
          ? "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
