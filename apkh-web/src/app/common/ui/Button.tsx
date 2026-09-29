import { forwardRef } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

// Variants/sizes own every colour, size and radius class — don't override them via
// className (without tailwind-merge the winner depends on CSS order). Add a variant instead.
type Variant = "primary" | "secondary" | "ghost" | "ghost-danger" | "danger" | "soft";
type Size = "sm" | "md" | "lg" | "toolbar" | "icon" | "icon-sm" | "fab";

const variants: Record<Variant, string> = {
  primary:
    "bg-linear-to-r from-blue-600 via-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25 hover:brightness-110 hover:shadow-lg hover:shadow-indigo-500/30 disabled:from-slate-300 disabled:via-slate-300 disabled:to-slate-300 disabled:text-slate-500 disabled:shadow-none dark:disabled:from-slate-700/80 dark:disabled:via-slate-700/80 dark:disabled:to-slate-700/80 dark:disabled:text-slate-200",
  secondary:
    "border border-line bg-surface text-fg shadow-xs hover:bg-surface-2 disabled:text-fg-subtle",
  ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg disabled:text-fg-subtle",
  "ghost-danger":
    "text-fg-subtle hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-500/10 dark:hover:text-rose-400",
  soft: "bg-accent-soft text-accent-fg hover:bg-indigo-100 dark:hover:bg-indigo-400/20 disabled:opacity-60",
  danger:
    "bg-rose-600 text-white shadow-md shadow-rose-500/20 hover:bg-rose-700 disabled:bg-rose-300",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
  lg: "h-12 gap-2 rounded-xl px-5 text-[0.95rem]",
  toolbar: "h-11 gap-2 rounded-xl px-3 text-sm sm:px-4",
  icon: "size-10 rounded-xl",
  "icon-sm": "size-8 rounded-lg",
  fab: "size-14 rounded-2xl shadow-xl",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, icon, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center font-semibold whitespace-nowrap transition-all duration-150 select-none active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});
