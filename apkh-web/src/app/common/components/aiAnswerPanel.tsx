"use client";

import ReactMarkdown from "react-markdown";
import { ArrowUpRight, CircleAlert, FileText, Hourglass, MessageSquarePlus, Paperclip, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { AiSearchResponse } from "@/service/noteService";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { displayFileName } from "../service/fileName";

type Reference = AiSearchResponse["references"][number];

const confidenceTone: Record<string, { label: string; classes: string }> = {
  high: { label: "High confidence", classes: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30" },
  medium: { label: "Medium confidence", classes: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30" },
  low: { label: "Low confidence", classes: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30" },
  not_found: { label: "Not found in notes", classes: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-500/30" },
};

/** Why a source matched: by meaning (with its similarity), by the query's words, or both. */
function matchLabel(reference: Reference) {
  const similarity = `${Math.round(reference.similarity_score * 100)}%`;
  if (reference.match === "keyword") return "Keywords";
  if (reference.match === "both") return `${similarity} · keywords`;
  return similarity;
}

function sourceMeta(reference: Reference) {
  if (reference.source_type === "file") {
    const page = typeof reference.source_page === "number" ? ` · page ${reference.source_page}` : "";
    return `${reference.source_name ? displayFileName(reference.source_name) : "Attachment"}${page}`;
  }
  return "From note content";
}

interface AiAnswerPanelProps {
  query: string;
  answer: AiSearchResponse | null;
  isSearching: boolean;
  errorMessage: string | null;
  onOpenNote: (noteId: string) => void;
  onContinue: () => void;
  continuing: boolean;
}

export function AiAnswerPanel({ query, answer, isSearching, errorMessage, onOpenNote, onContinue, continuing }: AiAnswerPanelProps) {
  const confidence = answer && !errorMessage ? confidenceTone[answer.confidence] ?? confidenceTone.medium : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
        {/* Question */}
        <div className="rounded-2xl bg-surface-2 px-4 py-3">
          <p className="text-[0.7rem] font-semibold tracking-wider text-fg-subtle uppercase">You asked</p>
          <p className="mt-1 font-medium text-fg">{answer?.query || query}</p>
        </div>

        {isSearching && (
          <div className="mt-6 space-y-4" aria-live="polite">
            <div className="flex items-center gap-3 text-sm font-medium text-accent">
              <span className="relative flex size-8 items-center justify-center rounded-xl bg-accent-soft">
                <Sparkles className="size-4 animate-pulse" />
              </span>
              Reading across your notes and attachments…
            </div>
            <div className="space-y-2.5">
              {[92, 100, 84, 96, 60].map((w, i) => (
                <div key={i} className="h-3.5 animate-pulse rounded-full bg-surface-2" style={{ width: `${w}%` }} />
              ))}
            </div>
            <div className="grid gap-2 pt-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface-2" />
              ))}
            </div>
          </div>
        )}

        {!isSearching && errorMessage && (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/30 dark:bg-rose-500/10">
            <div className="flex items-center gap-2 font-semibold text-rose-700 dark:text-rose-300">
              <CircleAlert className="size-4" /> AI search couldn&apos;t answer
            </div>
            <p className="mt-2 text-sm leading-relaxed text-rose-700/90 dark:text-rose-200/90">{errorMessage}</p>
            <Link
              href="/profile"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-rose-700 hover:underline dark:text-rose-300"
            >
              <Settings className="size-4" /> Check AI settings
            </Link>
          </div>
        )}

        {!isSearching && answer && !errorMessage && (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              {confidence && (
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold ring-1", confidence.classes)}>
                  {confidence.label}
                </span>
              )}
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-fg-muted ring-1 ring-line">
                {answer.references.length} source{answer.references.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="rich-content mt-4 text-fg">
              <ReactMarkdown>{answer.answer}</ReactMarkdown>
            </div>

            {Boolean(answer.pendingNotes) && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-fg-muted">
                <Hourglass className="mt-px size-3.5 shrink-0" />
                {answer.pendingNotes === 1 ? "1 note is" : `${answer.pendingNotes} notes are`} still being indexed and
                weren&apos;t searched yet.
              </p>
            )}

            <div className="mt-8">
              <h3 className="text-sm font-semibold text-fg">Sources</h3>
              <p className="text-xs text-fg-subtle">Open a source to jump into the note.</p>
              <div className="mt-3 space-y-2.5">
                {answer.references.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-fg-muted">
                    No direct source excerpts were returned for this answer.
                  </p>
                ) : (
                  answer.references.map((reference, index) => (
                    <button
                      key={`${reference.note_id}-${reference.source_name ?? "note"}-${index}`}
                      type="button"
                      onClick={() => onOpenNote(reference.note_id)}
                      className="group w-full cursor-pointer rounded-2xl border border-line bg-surface p-4 text-left transition-all hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/5 dark:hover:border-indigo-400/30"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                          {reference.source_type === "file" ? <Paperclip className="size-4" /> : <FileText className="size-4" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate font-semibold text-fg">{reference.note_title || "Untitled note"}</p>
                            <span
                              className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[0.7rem] font-semibold text-accent-fg"
                              title={
                                reference.match === "keyword"
                                  ? "Matched the words of your question"
                                  : "Similarity in meaning to your question"
                              }
                            >
                              {matchLabel(reference)}
                            </span>
                          </div>
                          <p className="truncate text-xs text-fg-subtle">{sourceMeta(reference)}</p>
                          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-fg-muted">{reference.excerpt}</p>
                        </div>
                        <ArrowUpRight className="size-4 shrink-0 text-fg-subtle transition-colors group-hover:text-accent" />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {!isSearching && answer && !errorMessage && (
        <div className="shrink-0 border-t border-line bg-surface px-5 py-4 sm:px-6">
          <Button onClick={onContinue} loading={continuing} className="w-full" icon={<MessageSquarePlus className="size-4" />}>
            Continue this conversation
          </Button>
        </div>
      )}
    </div>
  );
}
