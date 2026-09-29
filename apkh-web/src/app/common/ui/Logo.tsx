import Image from "next/image";
import { cn } from "./cn";

/** Brain-network mark (logo-main.png) — the same artwork in both themes. */
export function LogoMark({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <span className={cn("relative inline-flex shrink-0 overflow-hidden", className)} style={{ width: size, height: size }}>
      {/* logo-main.png has generous transparent padding — scale it to fill the box. */}
      <Image
        src="/assets/logo-main.png"
        alt=""
        width={size * 2}
        height={size * 2}
        priority
        className="size-full scale-[1.45] object-contain"
      />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[1.05rem] font-bold tracking-tight text-fg", className)}>
      Knowledge<span className="bg-linear-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-indigo-400 dark:to-violet-400"> Hub</span>
    </span>
  );
}

/** Full "logo + Knowledge Hub" artwork, used on auth and marketing pages.
 *  logo-with-text.png is a transparent, cropped cut of logo-with-text.jpg. The same
 *  image renders in both themes so layout is identical; in dark mode an
 *  invert + 180° hue-rotate lightens the navy text while keeping the brain blue. */
export function LogoWithText({ className }: { className?: string }) {
  return (
    <Image
      src="/assets/logo-with-text.png"
      alt="Knowledge Hub"
      width={1016}
      height={242}
      priority
      className={cn("h-auto w-48 dark:[filter:invert(1)_hue-rotate(180deg)_saturate(1.4)]", className)}
    />
  );
}
