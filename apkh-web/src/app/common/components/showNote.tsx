"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AtSign, ChevronDown, Clock, Paperclip, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { INote } from "../models/note";
import FileDisplay from "./fileDisplay";
import { normalizeNoteLinksInHtml, stripLegacyFileTokenStyles } from "../service/noteLinkUtils";
import { summarizeNote } from "@/service/noteService";
import { getErrorMessage } from "@/service/axios/axios";
import { Modal } from "../ui/Modal";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../ui/cn";
import { displayFileName } from "../service/fileName";

const ATTACHMENT_INDEXING_PENDING_SUMMARY =
  "Attachment text is still being indexed for this note. Please try the summary again in a moment.";

const PREVIEW_MAX_HEIGHT = 168; // px

interface NoteProps {
  note: INote;
  index?: number;
  selected?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleSelect?: () => void;
}

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function IconAction({
  label,
  onClick,
  active,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors [&>svg]:size-4",
          active
            ? "bg-accent-soft text-accent"
            : danger
              ? "text-fg-subtle hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
              : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export const ShowNote: React.FC<NoteProps> = ({ note, index = 0, selected = false, onEdit, onDelete, onToggleSelect }) => {
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [summaryMeta, setSummaryMeta] = useState<{ cached: boolean; model: string | null; generatedAt: string | null } | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const categoryLabel = note.category?.trim() || "Uncategorized";
  const attachmentCount = note.files.length;
  const normalizedContent = useMemo(
    () => normalizeNoteLinksInHtml(stripLegacyFileTokenStyles(note.content)),
    [note.content],
  );
  const hasContent = Boolean(note.content?.replace(/<[^>]+>/g, "").trim()) || note.content?.includes("file-token");
  const summaryPending = summaryText.trim() === ATTACHMENT_INDEXING_PENDING_SUMMARY;

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setIsTruncated(el.scrollHeight > PREVIEW_MAX_HEIGHT + 4);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [normalizedContent]);

  useEffect(() => {
    setSummaryOpen(false);
    setSummaryLoading(false);
    setSummaryText("");
    setSummaryError("");
    setSummaryMeta(null);
  }, [note.id, note.updatedAt]);

  const loadSummary = async () => {
    setSummaryLoading(true);
    setSummaryError("");
    setSummaryText("");
    setSummaryMeta(null);
    try {
      const response = await summarizeNote(note.id);
      setSummaryText(response.summary);
      setSummaryMeta({ cached: response.cached, model: response.model, generatedAt: response.generatedAt });
    } catch (error) {
      setSummaryError(getErrorMessage(error, "Couldn't generate the summary right now."));
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleSummaryClick = () => {
    if (summaryOpen && !summaryPending) {
      setSummaryOpen(false);
      return;
    }
    setSummaryOpen(true);
    if (summaryLoading) return;
    if (!summaryText || summaryPending || summaryError) void loadSummary();
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect?.();
      return;
    }
    // Don't hijack text selection or link clicks.
    if (window.getSelection()?.toString()) return;
    onEdit?.();
  };

  const handleContentClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const token = target.closest<HTMLElement>(".file-token");
    if (token?.dataset.id) {
      e.stopPropagation();
      setPreviewFile(token.dataset.id);
      return;
    }
    if (target.closest("a")) e.stopPropagation();
  };

  return (
    <>
      <article
        className={cn(
          "group relative mb-4 animate-rise cursor-pointer break-inside-avoid rounded-3xl border bg-surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-indigo-500/5",
          selected
            ? "border-indigo-300 ring-4 ring-indigo-500/15 dark:border-indigo-400/50"
            : "border-line hover:border-indigo-200 dark:hover:border-indigo-400/30",
        )}
        style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget) onEdit?.();
        }}
        tabIndex={0}
        aria-label={`Open note ${note.title || "Untitled note"}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="max-w-full truncate rounded-md bg-accent-soft px-2 py-0.5 text-[0.7rem] font-semibold text-accent-fg">
              {categoryLabel}
            </span>
            {attachmentCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[0.7rem] font-medium text-fg-muted">
                <Paperclip className="size-3" />
                {attachmentCount}
              </span>
            )}
          </div>
          <div
            className={cn(
              "-mt-1 -mr-1 flex shrink-0 items-center gap-0.5 transition-opacity",
              !selected && !summaryOpen && "sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100",
            )}
          >
            <IconAction label={selected ? "Unpin from AI question" : "Pin for AI question"} active={selected} onClick={() => onToggleSelect?.()}>
              <AtSign />
            </IconAction>
            <IconAction label={summaryOpen ? "Hide AI summary" : "AI summary"} active={summaryOpen} onClick={handleSummaryClick}>
              <Sparkles />
            </IconAction>
            <IconAction label="Delete note" danger onClick={() => onDelete?.()}>
              <Trash2 />
            </IconAction>
          </div>
        </div>

        <h2 className="mt-3 text-[1.05rem] leading-snug font-semibold tracking-tight break-words text-fg">
          {note.title || "Untitled note"}
        </h2>

        {/* Content preview */}
        {hasContent && (
          <div className="relative mt-2.5">
            <div
              ref={contentRef}
              onClick={handleContentClick}
              className={cn(
                "rich-content overflow-hidden text-sm",
                !expanded && isTruncated && "[mask-image:linear-gradient(to_bottom,black_65%,transparent)]",
              )}
              style={!expanded ? { maxHeight: PREVIEW_MAX_HEIGHT } : undefined}
              dangerouslySetInnerHTML={{ __html: normalizedContent }}
            />
          </div>
        )}

        {/* AI summary */}
        {summaryOpen && (
          <section
            onClick={(e) => e.stopPropagation()}
            className="mt-4 animate-fade-in cursor-default rounded-2xl border border-indigo-100 bg-linear-to-br from-blue-50/80 via-indigo-50/80 to-violet-50/80 p-4 dark:border-indigo-400/20 dark:from-blue-500/10 dark:via-indigo-500/10 dark:to-violet-500/10"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-fg">
                <Sparkles className="size-3.5" /> AI summary
              </span>
              {(summaryMeta || summaryError || summaryPending) && !summaryLoading && (
                <button
                  type="button"
                  onClick={() => void loadSummary()}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7rem] font-medium text-fg-subtle hover:bg-surface/70 hover:text-fg"
                  aria-label="Refresh summary"
                >
                  <RefreshCw className="size-3" />
                  Refresh
                </button>
              )}
            </div>

            <div className="mt-2 text-sm leading-relaxed">
              {summaryLoading && (
                <div className="space-y-2" aria-live="polite" aria-label="Generating summary">
                  {[100, 90, 70].map((w) => (
                    <div key={w} className="h-3 animate-pulse rounded-full bg-indigo-200/50 dark:bg-indigo-400/15" style={{ width: `${w}%` }} />
                  ))}
                </div>
              )}
              {!summaryLoading && summaryError && <p className="text-rose-600 dark:text-rose-400">{summaryError}</p>}
              {!summaryLoading && !summaryError && summaryText && (
                <div className="rich-content text-sm text-fg">
                  <ReactMarkdown>{summaryText}</ReactMarkdown>
                </div>
              )}
            </div>

            {summaryMeta && !summaryLoading && (
              <p className="mt-3 text-[0.7rem] text-fg-subtle">
                {summaryMeta.cached ? "Cached" : "Fresh"}
                {summaryMeta.model ? ` · ${summaryMeta.model}` : ""}
                {summaryMeta.generatedAt ? ` · ${dateFormat.format(new Date(summaryMeta.generatedAt))}` : ""}
              </p>
            )}
          </section>
        )}

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
            <Clock className="size-3.5" />
            {dateFormat.format(new Date(note.updatedAt))}
          </span>
          {isTruncated && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              aria-expanded={expanded}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent-soft"
            >
              {expanded ? "Show less" : "Show more"}
              <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
        </div>
      </article>

      <Modal open={Boolean(previewFile)} onClose={() => setPreviewFile(null)} title={previewFile ? displayFileName(previewFile) : ""} size="xl">
        {previewFile && <FileDisplay fileName={previewFile} noteId={note.id} />}
      </Modal>
    </>
  );
};
