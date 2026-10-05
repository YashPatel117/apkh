"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/errorBoundary";

/** Shown when rendering this route throws; the sidebar and top bar stay usable. */
export default function ChatError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return <ErrorFallback area="chat" error={error} onRetry={reset} className="h-full" />;
}
