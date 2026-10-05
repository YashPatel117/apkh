"use client";

import { useState } from "react";
import { ArrowUpRight, BookmarkPlus, Check, CircleAlert, FileText, Hourglass, MessageSquarePlus, Paperclip, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { AiSearchResponse } from "@/services/noteService";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { CitedMarkdown } from "@/components/citedMarkdown";
import { useSourceViewer } from "@/components/sourceViewer";
import { fromAiReference, sourceLocation } from "@/components/sources";
import { useSaveAnswerAsNote } from "@/hooks/useSaveAnswerAsNote";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage } from "@/services/axios";
import { MessageKey, useT } from "@/i18n";

type Reference = AiSearchResponse["references"][number];

const confidenceTone: Record<string, { label: MessageKey; classes: string }> = {
  high: { label: "ai.confidence.high", classes: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30" },
  medium: { label: "ai.confidence.medium", classes: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30" },
  low: { label: "ai.confidence.low", classes: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30" },
  not_found: { label: "ai.confidence.not_found", classes: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-500/30" },
};

/** Why a source matched: by meaning (with its similarity), by the query's words, or both. */
function matchLabel(reference: Reference) {
  const similarity = `${Math.round(reference.similarity_score * 100)}%`;
  if (reference.match === "keyword") return "Keywords";
  if (reference.match === "both") return `${similarity} · keywords`;
  return similarity;
}

interface AiAnswerPanelProps {
  query: string;
  answer: AiSearchResponse | null;
  isSearching: boolean;
  errorMessage: string | null;
  onContinue: () => void;
  continuing: boolean;
}

export function AiAnswerPanel({ query, answer, isSearching, errorMessage, onContinue, continuing }: AiAnswerPanelProps) {
  // The answer streams in: sources first, then the text as it is written.
  const writing = isSearching && Boolean(answer?.answer) && !answer?.isError;
  const finished = !isSearching && Boolean(answer) && !errorMessage;
  const confidence = finished ? confidenceTone[answer!.confidence] ?? confidenceTone.medium : null;
  const openSource = useSourceViewer();
  const openReference = (reference: Reference) => openSource(fromAiReference(reference));
  const saveAnswerAsNote = useSaveAnswerAsNote();
  const toast = useToast();
  const t = useT();
  const [saving, setSaving] = useState(false);
  // The answer already saved, so the same one isn't saved twice
  const [savedAnswer, setSavedAnswer] = useState<string | null>(null);

  const save = async () => {
    if (!answer) return;
    setSaving(true);
    try {
      await saveAnswerAsNote(answer.query || query, answer.answer, answer.references.map(fromAiReference));
      setSavedAnswer(answer.answer);
      toast(t("ai.savedToast"), "success");
    } catch (error) {
      toast(getErrorMessage(error, t("ai.saveFailed")), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
        {/* Question */}
        <div className="rounded-2xl bg-surface-2 px-4 py-3">
          <p className="text-[0.7rem] font-semibold tracking-wider text-fg-subtle uppercase">{t("ai.youAsked")}</p>
          <p className="mt-1 font-medium text-fg">{answer?.query || query}</p>
          {answer?.searchedFor && !isSearching && (
            <p className="mt-1.5 text-xs text-fg-muted">
              {t("ai.alsoSearched")} <span className="font-medium text-fg">“{answer.searchedFor}”</span>
            </p>
          )}
        </div>

        {isSearching && !writing && (
          <div className="mt-6 space-y-4" aria-live="polite">
            <div className="flex items-center gap-3 text-sm font-medium text-accent">
              <span className="relative flex size-8 items-center justify-center rounded-xl bg-accent-soft">
                <Sparkles className="size-4 animate-pulse" />
              </span>
              {answer ? t("ai.writingWithSources", { count: answer.references.length }) : t("ai.reading")}
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
              <CircleAlert className="size-4" /> {t("ai.couldntAnswer")}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-rose-700/90 dark:text-rose-200/90">{errorMessage}</p>
            <Link
              href="/profile"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-rose-700 hover:underline dark:text-rose-300"
            >
              <Settings className="size-4" /> {t("ai.checkSettings")}
            </Link>
          </div>
        )}

        {(writing || finished) && answer && (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              {writing && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent-fg">
                  <Sparkles className="size-3 animate-pulse" />
                  {t("ai.writing")}
                </span>
              )}
              {confidence && (
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold ring-1", confidence.classes)}>
                  {t(confidence.label)}
                </span>
              )}
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-fg-muted ring-1 ring-line">
                {t("ai.sourceCount", { count: answer.references.length })}
              </span>
            </div>

            <div className="rich-content mt-4 text-fg" aria-busy={writing}>
              <CitedMarkdown
                text={answer.answer}
                sourceCount={answer.references.length}
                onCite={(n) => openReference(answer.references[n - 1])}
              />
            </div>

            {finished && Boolean(answer.pendingNotes) && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-fg-muted">
                <Hourglass className="mt-px size-3.5 shrink-0" />
                {t("ai.pendingNotes", { count: answer.pendingNotes ?? 0 })}
              </p>
            )}

            <div className="mt-8">
              <h3 className="text-sm font-semibold text-fg">{t("ai.sources")}</h3>
              <p className="text-xs text-fg-subtle">{t("ai.sourcesHint")}</p>
              <div className="mt-3 space-y-2.5">
                {answer.references.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-fg-muted">
                    {t("ai.noSources")}
                  </p>
                ) : (
                  answer.references.map((reference, index) => (
                    <button
                      key={`${reference.note_id}-${reference.source_name ?? "note"}-${index}`}
                      type="button"
                      onClick={() => openReference(reference)}
                      className="group w-full cursor-pointer rounded-2xl border border-line bg-surface p-4 text-left transition-all hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/5 dark:hover:border-indigo-400/30"
                    >
                      <div className="flex items-start gap-3">
                        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                          {reference.source_type === "file" ? <Paperclip className="size-4" /> : <FileText className="size-4" />}
                          <span className="absolute -top-1.5 -left-1.5 flex size-4 items-center justify-center rounded-full bg-surface text-[0.6rem] font-bold text-fg-muted ring-1 ring-line">
                            {index + 1}
                          </span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate font-semibold text-fg">{reference.note_title || t("ai.untitled")}</p>
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
                          <p className="truncate text-xs text-fg-subtle">
                            {sourceLocation(fromAiReference(reference), t)}
                            {reference.cited && <span className="font-semibold text-accent-fg"> · {t("ai.cited")}</span>}
                          </p>
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

      {finished && answer && (
        <div className="flex shrink-0 gap-2 border-t border-line bg-surface px-5 py-4 sm:px-6">
          <Button
            variant="secondary"
            onClick={() => void save()}
            loading={saving}
            disabled={savedAnswer === answer.answer}
            icon={savedAnswer === answer.answer ? <Check className="size-4" /> : <BookmarkPlus className="size-4" />}
          >
            {savedAnswer === answer.answer ? t("ai.saved") : t("ai.saveAsNote")}
          </Button>
          <Button onClick={onContinue} loading={continuing} className="flex-1" icon={<MessageSquarePlus className="size-4" />}>
            {t("ai.continue")}
          </Button>
        </div>
      )}
    </div>
  );
}
