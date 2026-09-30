"use client";

import { Fragment, useRef } from "react";
import { cn } from "@/lib/cn";

/** Letters and digits only, upper-cased. */
export function normalizeCode(text: string) {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Whether every box of a CodeInput value is filled. */
export function isCodeComplete(value: string, length = 8) {
  return value.length === length && !value.includes(" ");
}

interface CodeInputProps {
  /** One character per box; an empty box is a space */
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter once every box is filled */
  onComplete?: () => void;
  length?: number;
  /** A dash is shown after every `group` characters */
  group?: number;
  disabled?: boolean;
  invalid?: boolean;
}

/**
 * One box per character, like a device-login code: typing moves to the next
 * box, Backspace to the previous one, and a pasted code fills them all.
 */
export function CodeInput({ value, onChange, onComplete, length = 8, group = 4, disabled, invalid }: CodeInputProps) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const chars = Array.from({ length }, (_, i) => (value[i] ?? " ").trim());

  const focus = (index: number) => {
    const box = boxes.current[Math.max(0, Math.min(length - 1, index))];
    box?.focus();
    box?.select();
  };

  const emit = (next: string[]) => onChange(next.map((c) => c || " ").join(""));

  // Writes `text` into the boxes from `from` on (one typed character, or a paste).
  const fill = (from: number, text: string) => {
    const typed = normalizeCode(text).slice(0, length - from);
    if (!typed) return;
    const next = chars.slice();
    typed.split("").forEach((char, i) => (next[from + i] = char));
    emit(next);
    focus(from + typed.length);
  };

  const clear = (index: number) => {
    const next = chars.slice();
    next[index] = "";
    emit(next);
  };

  return (
    <div className="flex w-full items-center justify-center gap-1 sm:gap-1.5" role="group" aria-label={`${length}-character code`}>
      {chars.map((char, i) => (
        <Fragment key={i}>
          {i > 0 && i % group === 0 && (
            <span aria-hidden className="shrink-0 text-lg font-semibold text-fg-subtle">
              -
            </span>
          )}
          <input
            ref={(el) => {
              boxes.current[i] = el;
            }}
            value={char}
            disabled={disabled}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-label={`Character ${i + 1} of ${length}`}
            aria-invalid={invalid || undefined}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const typed = normalizeCode(e.target.value);
              if (!typed) return clear(i);
              // The caret was beside the box's character instead of over it: keep the new one.
              if (char && typed.length === 2) return fill(i, typed[0] === char ? typed[1] : typed[0]);
              fill(i, typed);
            }}
            onPaste={(e) => {
              e.preventDefault();
              const pasted = e.clipboardData.getData("text");
              // A whole code fills from the first box, wherever the caret is.
              fill(normalizeCode(pasted).length >= length ? 0 : i, pasted);
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !char && i > 0) {
                e.preventDefault();
                clear(i - 1);
                focus(i - 1);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                focus(i - 1);
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                focus(i + 1);
              } else if (e.key === "Enter" && isCodeComplete(value, length)) {
                onComplete?.();
              }
            }}
            className={cn(
              // Boxes share the row's width (at most 3rem each), so the code fits any dialog.
              "aspect-square w-0 min-w-0 max-w-12 flex-1 rounded-xl border bg-surface p-0 text-center font-mono text-lg font-semibold text-fg uppercase shadow-sm transition-colors outline-none sm:text-xl",
              "focus:border-accent focus:ring-2 focus:ring-indigo-500/25 disabled:opacity-60",
              invalid ? "border-rose-400 dark:border-rose-500/60" : "border-line",
            )}
          />
        </Fragment>
      ))}
    </div>
  );
}
