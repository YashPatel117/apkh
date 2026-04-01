import React, { useEffect, useRef, useState } from "react";
import Modal from "@mui/material/Modal";
import Box from "@mui/material/Box";
import { IconButton } from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import EditNoteRoundedIcon from "@mui/icons-material/EditNoteRounded";
import DeleteForeverRoundedIcon from "@mui/icons-material/DeleteForeverRounded";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import { INote } from "../models/note";
import FileDisplay from "./fileDisplay";
import { modalStyle } from "../style/modal";
import { normalizeNoteLinksInHtml } from "../service/noteLinkUtils";
import { summarizeNote } from "@/service/noteService";
import axios from "axios";
import ReactMarkdown from "react-markdown";

interface NoteProps {
  note: INote;
  lineLength?: number;
  onEdit?: () => void;
  onDelete?: () => void;
}

export const ShowNote: React.FC<NoteProps> = ({
  note,
  lineLength = 3,
  onEdit,
  onDelete,
}) => {
  const [showLinesNumber, setShowLinesNumber] = useState<number | null>(lineLength);
  const [isTruncated, setIsTruncated] = useState(false);
  const [openFile, setOpenFile] = useState(false);
  const [fileName, setFileName] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [summaryMeta, setSummaryMeta] = useState<{
    cached: boolean;
    model: string | null;
    generatedAt: string | null;
  } | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const isCollapsed = Boolean(showLinesNumber);
  const previewMaxHeight = `${Math.max(lineLength * 2.65, 8.75)}rem`;
  const categoryLabel = note.category?.trim() || "Uncategorized";
  const attachmentCount = note.files.length;
  const normalizedContent = normalizeNoteLinksInHtml(note.content);
  const updatedLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(note.updatedAt));
  const summaryGeneratedLabel = summaryMeta?.generatedAt
    ? new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(summaryMeta.generatedAt))
    : "";

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const measure = () => {
      setIsTruncated(el.scrollHeight > el.clientHeight + 4);
    };

    requestAnimationFrame(measure);

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(el);

    return () => observer.disconnect();
  }, [lineLength, normalizedContent, showLinesNumber]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const token = target.closest(".file-token") as HTMLElement | null;
      if (token && token.dataset.id) {
        setOpenFile(true);
        setFileName(token.dataset.id);
      }
    };

    const current = contentRef.current;
    current?.addEventListener("click", handleClick);

    return () => {
      current?.removeEventListener("click", handleClick);
    };
  }, []);

  useEffect(() => {
    setSummaryOpen(false);
    setSummaryLoading(false);
    setSummaryText("");
    setSummaryError("");
    setSummaryMeta(null);
  }, [note.id, note.updatedAt]);

  const getSummaryErrorMessage = (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const apiMessage =
        error.response?.data?.message ?? error.response?.data?.detail;
      if (typeof apiMessage === "string" && apiMessage.trim()) {
        return apiMessage;
      }
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return "Couldn't generate the summary right now.";
  };

  const handleSummaryClick = async () => {
    if (summaryOpen && (summaryText || summaryError)) {
      setSummaryOpen(false);
      return;
    }

    setSummaryOpen(true);

    if (summaryText || summaryLoading) {
      return;
    }

    setSummaryLoading(true);
    setSummaryError("");

    try {
      const response = await summarizeNote(note.id);
      setSummaryText(response.summary);
      setSummaryMeta({
        cached: response.cached,
        model: response.model,
        generatedAt: response.generatedAt,
      });
    } catch (error) {
      setSummaryError(getSummaryErrorMessage(error));
    } finally {
      setSummaryLoading(false);
    }
  };

  return (
    <>
      <article className="group mb-5 break-inside-avoid overflow-hidden rounded-[28px] border border-white/80 bg-[linear-gradient(140deg,_rgba(255,255,255,0.95),_rgba(240,249,255,0.95)_58%,_rgba(239,246,255,0.92)_100%)] p-[1px] shadow-[0_22px_60px_-42px_rgba(15,23,42,0.7)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_28px_70px_-38px_rgba(2,132,199,0.35)]">
        <div className="rounded-[27px] bg-white/92 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700 ring-1 ring-sky-100">
                  {categoryLabel}
                </span>
                {attachmentCount > 0 && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                    {attachmentCount} attachment{attachmentCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <h2 className="mt-3 break-words text-lg font-semibold tracking-tight text-slate-900">
                {note.title || "Untitled note"}
              </h2>
            </div>

            <div className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200/80 bg-white/90 p-1 shadow-sm">
              <IconButton
                onClick={handleSummaryClick}
                className="p-1.5!"
                size="small"
                aria-label={`${summaryOpen ? "Hide" : "Show"} summary for ${note.title || "note"}`}
              >
                <AutoAwesomeRoundedIcon fontSize="small" />
              </IconButton>
              <IconButton
                onClick={onEdit}
                className="p-1.5!"
                size="small"
                aria-label={`Edit ${note.title || "note"}`}
              >
                <EditNoteRoundedIcon fontSize="small" />
              </IconButton>
              <IconButton
                onClick={onDelete}
                className="p-1.5!"
                size="small"
                aria-label={`Delete ${note.title || "note"}`}
              >
                <DeleteForeverRoundedIcon fontSize="small" />
              </IconButton>
            </div>
          </div>

          <div className="mt-4 rounded-[22px] border border-slate-100 bg-slate-50/90 px-4 py-3 shadow-inner">
            <div
              ref={contentRef}
              className="note-rich-content text-sm"
              data-collapsed={isCollapsed && isTruncated}
              style={isCollapsed ? { maxHeight: previewMaxHeight } : undefined}
              dangerouslySetInnerHTML={{ __html: normalizedContent }}
            />
          </div>

          {summaryOpen && (
            <section className="mt-4 rounded-[22px] border border-amber-100 bg-[linear-gradient(140deg,_rgba(255,251,235,0.95),_rgba(255,255,255,0.98))] px-4 py-3 shadow-inner">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800 ring-1 ring-amber-200">
                  AI Summary
                </span>
                {summaryMeta && (
                  <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                    {summaryMeta.cached ? "From cache" : "Freshly generated"}
                    {summaryMeta.model ? ` | ${summaryMeta.model}` : ""}
                    {summaryGeneratedLabel ? ` | ${summaryGeneratedLabel}` : ""}
                  </span>
                )}
              </div>

              <div className="mt-3 text-sm leading-6 text-slate-700">
                {summaryLoading && (
                  <p className="text-slate-500">Generating summary...</p>
                )}

                {!summaryLoading && summaryError && (
                  <p className="text-rose-600">{summaryError}</p>
                )}

                {!summaryLoading && !summaryError && summaryText && (
                  <div className="prose">
                    <ReactMarkdown>{summaryText}</ReactMarkdown>
                  </div>
                )}
              </div>
            </section>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 ring-1 ring-slate-200">
                <AccessTimeRoundedIcon sx={{ fontSize: 14 }} />
                Updated {updatedLabel}
              </span>
            </div>

            {lineLength && (isTruncated || !isCollapsed) && (
              <button
                type="button"
                onClick={() =>
                  setShowLinesNumber(showLinesNumber === lineLength ? null : lineLength)
                }
                className="rounded-full border border-sky-100 bg-sky-50 px-3.5 py-1.5 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-100"
              >
                {showLinesNumber === lineLength ? "See more" : "See less"}
              </button>
            )}
          </div>
        </div>
      </article>

      <Modal open={openFile} onClose={() => setOpenFile(false)}>
        <Box sx={modalStyle()}>
          <FileDisplay fileName={fileName} noteId={note.id} />
        </Box>
      </Modal>
    </>
  );
};
