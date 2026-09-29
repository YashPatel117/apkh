"use client";

import { forwardRef, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "./cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: React.ReactNode;
  error?: string | null;
  icon?: React.ReactNode;
}

export const fieldClass =
  "w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-fg shadow-xs transition-colors placeholder:text-fg-subtle hover:border-indigo-300 focus:border-accent focus:ring-4 focus:ring-indigo-500/15 focus:outline-none disabled:opacity-60 dark:hover:border-indigo-400/50";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, className, id, type = "text", ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [reveal, setReveal] = useState(false);
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
            aria-label={reveal ? "Hide password" : "Show password"}
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
