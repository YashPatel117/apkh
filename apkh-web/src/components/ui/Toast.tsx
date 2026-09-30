"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "success" | "error" | "info";
type Toast = { id: number; tone: Tone; message: string };

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

export const useToast = () => useContext(ToastContext);

const icons = { success: CircleCheck, error: CircleAlert, info: Info };
const tones: Record<Tone, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-rose-600 dark:text-rose-400",
  info: "text-accent",
};

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (message: string, tone: Tone = "info") => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:right-4 sm:left-auto sm:items-end"
      >
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex w-full max-w-sm animate-scale-in items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-fg shadow-xl shadow-slate-900/10"
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", tones[t.tone])} />
              <p className="flex-1 leading-snug">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-mr-1 cursor-pointer rounded-md p-0.5 text-fg-subtle hover:text-fg"
                aria-label="Dismiss"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
