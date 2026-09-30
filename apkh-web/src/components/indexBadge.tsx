"use client";

import { RotateCw } from "lucide-react";
import { IndexedFileStatus, NoteIndexState } from "@/models/note";
import { displayFileName } from "@/lib/fileName";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";

const FILE_PROBLEMS: Record<IndexedFileStatus, string> = {
  ok: "",
  empty: "no readable text",
  unsupported: "file type isn't supported",
  no_vision: "needs an AI model that can read images",
  missing: "missing from storage",
  failed: "couldn't be read",
};

function problemOf(file: NoteIndexState["files"][number]) {
  if (file.status === "ok") return file.warning ?? "not fully read";
  if (file.status === "failed" && file.error) return file.error;
  return FILE_PROBLEMS[file.status];
}

/** Attachments that weren't (fully) indexed, as "name: reason" lines. */
export function attachmentProblems(state: NoteIndexState): string[] {
  return state.files.map((file) => `${displayFileName(file.name)}: ${problemOf(file)}`);
}

const pill = "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.7rem] font-medium";
const warnTone = "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300";

/**
 * Search-index state of a note, shown only when it matters: while indexing,
 * or when the note (or one of its attachments) isn't searchable.
 */
export function IndexBadge({ state, onRetry }: { state?: NoteIndexState; onRetry?: () => void }) {
  if (!state) return null;

  const retry = onRetry && (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRetry();
      }}
      className="-mr-1 ml-0.5 flex size-4 cursor-pointer items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10"
      aria-label="Retry indexing"
    >
      <RotateCw className="size-3" />
    </button>
  );

  if (state.status === "queued" || state.status === "processing") {
    return (
      <Tooltip label={state.error ? `Retrying: ${state.error}` : "Being indexed for AI search"}>
        <span className={cn(pill, "bg-surface-2 text-fg-muted")}>
          <Spinner className="size-3" /> Indexing
        </span>
      </Tooltip>
    );
  }

  if (state.status === "skipped") {
    return (
      <Tooltip label={state.error ?? "Add an AI key in Profile to index this note."}>
        <span className={cn(pill, warnTone)}>Not indexed</span>
      </Tooltip>
    );
  }

  if (state.status === "failed") {
    return (
      <Tooltip label={state.error ?? "Indexing failed"}>
        <span className={cn(pill, "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300")}>
          Index failed
          {retry}
        </span>
      </Tooltip>
    );
  }

  const problems = attachmentProblems(state);
  if (!problems.length) return null;
  const retryable = state.files.some((file) => file.status === "failed" || file.status === "no_vision");
  return (
    <Tooltip label={problems.join(" · ")}>
      <span className={cn(pill, warnTone)}>
        {problems.length === 1 ? "1 attachment" : `${problems.length} attachments`} not fully read
        {retryable && retry}
      </span>
    </Tooltip>
  );
}
