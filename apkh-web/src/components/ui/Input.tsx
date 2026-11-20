"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: React.ReactNode;
  error?: string | null;
  icon?: React.ReactNode;
}

export const fieldClass =
  "w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-fg shadow-xs transition-colors placeholder:text-fg-subtle hover:border-indigo-300 focus:border-accent focus:ring-4 focus:ring-indigo-500/15 focus:outline-none disabled:opacity-60 dark:hover:border-indigo-400/50";

export interface SelectOption {
  value: string;
  label: string;
}

/** Custom dropdown (rounded, themed list) with the same height/look as Input. */
export function SelectBox({
  value,
  onChange,
  options,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const selected = options.findIndex((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 6, left: r.left, width: r.width });
    setActive(Math.max(selected, 0));
    setOpen(true);
  };
  const pick = (i: number) => {
    onChange(options[i].value);
    setOpen(false);
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) return show();
            setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            pick(active);
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className={cn(fieldClass, "flex h-11 cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-default")}
      >
        <span className="truncate">{options[selected]?.label ?? ""}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")} />
      </button>
      {open && rect && createPortal(
        <ul
          ref={listRef}
          role="listbox"
          style={{ top: rect.top, left: rect.left, minWidth: rect.width }}
          className="fixed z-[200] animate-scale-in overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-xl shadow-slate-900/10"
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === selected}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm",
                i === active ? "bg-accent-soft text-accent-fg" : "text-fg-muted",
                i === selected && "font-semibold text-fg",
              )}
            >
              {o.label}
              {i === selected && <Check className="size-3.5 text-accent" />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, className, id, type = "text", ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [reveal, setReveal] = useState(false);
  const t = useT();
  const isPassword = type === "password";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-fg">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-subtle [&>svg]:size-4">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          type={isPassword && reveal ? "text" : type}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error || hint ? `${inputId}-desc` : undefined}
          className={cn(
            fieldClass,
            "h-11",
            Boolean(icon) && "pl-10",
            isPassword && "pr-11",
            error && "border-rose-400 focus:border-rose-500 focus:ring-rose-500/15",
          )}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label={reveal ? t("common.hidePassword") : t("common.showPassword")}
          >
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
      {(error || hint) && (
        <p id={`${inputId}-desc`} className={cn("text-xs", error ? "text-rose-600 dark:text-rose-400" : "text-fg-subtle")}>
          {error || hint}
        </p>
      )}
    </div>
  );
});
