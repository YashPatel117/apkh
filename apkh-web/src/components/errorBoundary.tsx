"use client";

import { Component } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";

export type ErrorArea = "editor" | "answer" | "file" | "chat" | "page";

/** What's shown instead of a part of the app that crashed. */
export function ErrorFallback({ area, error, onRetry, className }: { area: ErrorArea; error?: Error; onRetry: () => void; className?: string }) {
  const t = useT();
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <span className="flex size-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
        <TriangleAlert className="size-5" />
      </span>
      <h2 className="mt-4 font-semibold text-fg">{t("error.title")}</h2>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">{t(`error.${area}`)}</p>
      {process.env.NODE_ENV !== "production" && error?.message && (
        <pre className="mt-3 max-w-full overflow-x-auto rounded-xl bg-surface-2 px-3 py-2 text-left text-xs text-fg-subtle">{error.message}</pre>
      )}
      <Button variant="secondary" className="mt-5" onClick={onRetry} icon={<RotateCcw className="size-4" />}>
        {t("error.retry")}
      </Button>
    </div>
  );
}

interface ErrorBoundaryProps {
  area: ErrorArea;
  children: React.ReactNode;
  /** The boundary resets (renders its children again) when any of these change, e.g. another note opens */
  resetKeys?: unknown[];
  className?: string;
}

/**
 * Keeps a crash in one part of the app (the editor, an AI answer, a file
 * preview, a chat) from blanking the whole page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.area}]`, error, info.componentStack);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (!this.state.error) return;
    const before = previous.resetKeys ?? [];
    const after = this.props.resetKeys ?? [];
    if (before.length !== after.length || before.some((key, i) => !Object.is(key, after[i]))) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return <ErrorFallback area={this.props.area} error={this.state.error} className={this.props.className} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
