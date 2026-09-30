"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, ChevronDown, Clock, Layers, Paperclip, Sparkles, Trash2 } from "lucide-react";
import { INote, NoteIndexState } from "../models/note";
import { IndexBadge } from "./indexBadge";
import { NoteSummaryPanel } from "./noteSummaryPanel";
import { SimilarNotesModal } from "./similarNotes";
import { useNotes } from "../context/notesContext";
import FileDisplay from "./fileDisplay";
import { normalizeNoteLinksInHtml, stripLegacyFileTokenStyles } from "../service/noteLinkUtils";
import { Modal } from "../ui/Modal";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../ui/cn";
import { displayFileName } from "../service/fileName";

const PREVIEW_MAX_HEIGHT = 168; // px

interface NoteProps {
  note: INote;
  index?: number;
  selected?: boolean;
  /** Search-index state; a badge shows while indexing or when something isn't searchable */
  indexState?: NoteIndexState;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleSelect?: () => void;
  onReindex?: () => void;
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

export const ShowNote: React.FC<NoteProps> = ({ note, index = 0, selected = false, indexState, onEdit, onDelete, onToggleSelect, onReindex }) => {
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);
  const { openNote } = useNotes();

  const contentRef = useRef<HTMLDivElement>(null);
  const categoryLabel = note.category?.trim() || "Uncategorized";
  const attachmentCount = note.files.length;
  const normalizedContent = useMemo(
    () => normalizeNoteLinksInHtml(stripLegacyFileTokenStyles(note.content)),
    [note.content],
  );
  // Stable, so re-renders don't make React rebuild the preview's DOM (and lose text selection).
  const contentHtml = useMemo(() => ({ __html: normalizedContent }), [normalizedContent]);
  const hasContent = Boolean(note.content?.replace(/<[^>]+>/g, "").trim()) || note.content?.includes("file-token");

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
            <IndexBadge state={indexState} onRetry={onReindex} />
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
            <IconAction label={summaryOpen ? "Hide AI summary" : "AI summary"} active={summaryOpen} onClick={() => setSummaryOpen((open) => !open)}>
              <Sparkles />
            </IconAction>
            <IconAction label="Similar notes" onClick={() => setSimilarOpen(true)}>
              <Layers />
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
              dangerouslySetInnerHTML={contentHtml}
            />
          </div>
        )}

        {/* AI summary */}
        {summaryOpen && <NoteSummaryPanel noteId={note.id} updatedAt={note.updatedAt} />}

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

      <SimilarNotesModal
        noteId={note.id}
        noteTitle={note.title}
        open={similarOpen}
        onClose={() => setSimilarOpen(false)}
        onOpenNote={openNote}
      />

      <Modal open={Boolean(previewFile)} onClose={() => setPreviewFile(null)} title={previewFile ? displayFileName(previewFile) : ""} size="xl">
        {previewFile && <FileDisplay fileName={previewFile} noteId={note.id} />}
      </Modal>
    </>
  );
};
