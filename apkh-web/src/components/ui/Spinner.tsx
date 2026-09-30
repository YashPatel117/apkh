import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cn("size-5 animate-spin", className)} />;
}
