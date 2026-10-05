"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

type Placement = "center" | "right" | "left";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Accessible title; also rendered as the header when `title` is shown. */
  title?: React.ReactNode;
  description?: React.ReactNode;
  placement?: Placement;
  /** Width of a centered dialog. */
  size?: keyof typeof widths;
  className?: string;
  /** Prevents closing via backdrop/Escape (e.g. while saving). */
  locked?: boolean;
  hideClose?: boolean;
}

const panel: Record<Placement, string> = {
  center:
    "relative m-auto flex max-h-[92dvh] w-full animate-scale-in flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl shadow-slate-900/20",
  right:
    "relative ml-auto flex h-dvh w-full max-w-xl animate-slide-in-right flex-col overflow-hidden border-l border-line bg-surface shadow-2xl",
  left: "relative mr-auto flex h-dvh w-72 max-w-[85vw] animate-slide-in-left flex-col overflow-hidden bg-surface shadow-2xl",
};

const widths = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-3xl", xl: "max-w-5xl" };

let openCount = 0;

export function Modal({
  open,
  onClose,
  children,
  title,
  description,
  placement = "center",
  size = "md",
  className,
  locked = false,
  hideClose = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const t = useT();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    openCount += 1;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || lockedRef.current) return;
      // Only the top-most modal handles Escape.
      const modals = document.querySelectorAll("[data-modal-root]");
      if (modals[modals.length - 1]?.contains(panelRef.current)) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);

    requestAnimationFrame(() => {
      const el = panelRef.current;
      if (!el || el.contains(document.activeElement)) return;
      const focusable = el.querySelector<HTMLElement>("[data-autofocus], input, textarea, [contenteditable=true]");
      (focusable ?? el).focus({ preventScroll: true });
    });

    return () => {
      document.removeEventListener("keydown", onKey);
      openCount -= 1;
      if (openCount === 0) document.body.style.overflow = "";
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div data-modal-root className={cn("fixed inset-0 z-50 flex", placement === "center" && "sm:p-4")}>
      <div
        className="fixed inset-0 animate-fade-in bg-slate-950/45 backdrop-blur-sm"
        onClick={() => !locked && onClose()}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        className={cn(
          panel[placement],
          placement === "center" && [widths[size], "max-sm:mt-auto max-sm:mb-0 max-sm:max-h-[94dvh] max-sm:rounded-b-none"].join(" "),
          "focus:outline-none",
          className,
        )}
      >
        {(title || !hideClose) && (
          <div className={cn("flex shrink-0 items-start gap-4 px-5 pt-5 sm:px-6", title ? "pb-4" : "pb-0")}>
            {title && (
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
                {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
              </div>
            )}
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                disabled={locked}
                className="ml-auto flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                aria-label={t("common.close")}
              >
                <X className="size-5" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
