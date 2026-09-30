import { cn } from "@/lib/cn";

/** CSS-only tooltip; shows on hover and keyboard focus. */
export function Tooltip({
  label,
  children,
  side = "top",
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  if (!label) return <>{children}</>;
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-60 -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-center text-xs font-medium text-white opacity-0 shadow-lg transition-opacity delay-150 duration-150 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100 dark:bg-slate-700",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        {label}
      </span>
    </span>
  );
}
