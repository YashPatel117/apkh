"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { fieldClass } from "@/components/ui/Input";
import { cn } from "@/lib/cn";

/** Free-text input with suggestions from existing categories. */
export function CategoryInput({
  value,
  onChange,
  options,
  label = "Category",
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  label?: string;
  placeholder?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const q = value.trim().toLowerCase();
  const matches = options.filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q).slice(0, 8);
  const exact = options.some((o) => o.toLowerCase() === q);
  const items = [...matches.map((m) => ({ value: m, create: false })), ...(q && !exact ? [{ value: value.trim(), create: true }] : [])];

  useEffect(() => setActive(0), [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <FolderOpen className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open || items.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % items.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + items.length) % items.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(items[active].value);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className={cn(fieldClass, "h-11 pl-10")}
        />
      </div>
      {open && items.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-56 animate-scale-in overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl shadow-slate-900/10"
        >
          {items.map((item, i) => (
            <li
              key={`${item.create}-${item.value}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item.value);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm",
                i === active ? "bg-accent-soft text-accent-fg" : "text-fg-muted",
              )}
            >
              {item.create ? <Plus className="size-3.5" /> : <FolderOpen className="size-3.5" />}
              {item.create ? (
                <span>
                  Create <span className="font-semibold">“{item.value}”</span>
                </span>
              ) : (
                <span>{item.value}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
