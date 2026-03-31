"use client";

import { ShowNote } from "@/app/common/components/showNote";
import { useContext } from "react";
import { NotesContext } from "@/app/common/context/notesContext";
import { useAppDispatch } from "@/store/hook";
import { deleteNote as deleteNoteAction } from "@/store/slices/noteSlice";
import { deleteNote } from "@/service/noteService";
import { CircularProgress } from "@mui/material";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import MenuBookRoundedIcon from "@mui/icons-material/MenuBookRounded";
import ReactMarkdown from "react-markdown";
import { AiSearchResponse } from "@/service/noteService";

const confidenceTone: Record<
  string,
  { label: string; classes: string }
> = {
  high: {
    label: "High confidence",
    classes: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  medium: {
    label: "Medium confidence",
    classes: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  low: {
    label: "Low confidence",
    classes: "bg-orange-50 text-orange-700 ring-orange-200",
  },
  not_found: {
    label: "Not found",
    classes: "bg-slate-100 text-slate-600 ring-slate-200",
  },
};

function buildSourceMeta(reference: AiSearchResponse["references"][number]) {
  if (reference.source_type === "file") {
    const pageLabel =
      typeof reference.source_page === "number"
        ? `, page ${reference.source_page}`
        : "";
    return `${reference.source_name ?? "Attachment"}${pageLabel}`;
  }

  return "Directly from note content";
}

export default function NotesPage() {
  const { openNote, filteredNotes, aiAnswer, isAiSearching } =
    useContext(NotesContext);
  const dispatch = useAppDispatch();

  const confidence =
    (aiAnswer && confidenceTone[aiAnswer.confidence]) || confidenceTone.medium;

  return (
    <>
      <style>{`
        .card {
          flex: 1;
          max-width: 500px;
          min-width: 300px;
        }

        .reference-excerpt {
          display: -webkit-box;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        @media (max-width: 350px) {
          .card {
            min-width: 200px;
            width: auto;
          }
        }
      `}</style>

      <div className="p-4 sm:px-6 sm:pb-8">
        {isAiSearching && (
          <div className="mb-8 overflow-hidden rounded-[30px] border border-sky-100 bg-white/90 shadow-[0_28px_80px_-52px_rgba(14,116,144,0.75)]">
            <div className="grid gap-5 p-6 md:grid-cols-[auto_1fr] md:items-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                <CircularProgress size={26} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-700">
                  AI Search In Progress
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                  Reading across your notes and attachments
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  The assistant is grounding the answer with indexed note text,
                  file excerpts, and the most relevant references it can find.
                </p>
              </div>
            </div>
          </div>
        )}

        {aiAnswer && !isAiSearching && (
          <div className="mb-8 overflow-hidden rounded-[32px] border border-sky-100 bg-[linear-gradient(160deg,_rgba(240,249,255,0.98),_rgba(255,255,255,0.96)_45%,_rgba(238,242,255,0.94)_100%)] shadow-[0_30px_90px_-56px_rgba(37,99,235,0.7)]">
            <div className="border-b border-sky-100/90 px-6 py-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                    <AutoAwesomeOutlinedIcon sx={{ fontSize: 16 }} />
                    AI Answer Panel
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
                    {aiAnswer.query}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    This answer is grounded in your saved notes and attached
                    files. Open any source card to jump straight into the note.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${confidence.classes}`}
                  >
                    {confidence.label}
                  </span>
                  <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                    {aiAnswer.references.length} source
                    {aiAnswer.references.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
              <div className="rounded-[28px] border border-white/80 bg-white/88 p-5 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.9)]">
                <div className="mb-4 flex items-center gap-2 text-sky-700">
                  <AutoAwesomeOutlinedIcon />
                  <h3 className="text-lg font-semibold text-slate-900">
                    Synthesized answer
                  </h3>
                </div>
                <div className="prose prose-slate max-w-none text-slate-700">
                  <ReactMarkdown>{aiAnswer.answer}</ReactMarkdown>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      Source trail
                    </h3>
                    <p className="text-sm text-slate-500">
                      Click a source to open the matching note.
                    </p>
                  </div>
                </div>

                {aiAnswer.references.length > 0 ? (
                  aiAnswer.references.map((reference, index) => (
                    <button
                      key={`${reference.note_id}-${reference.source_name ?? "note"}-${index}`}
                      onClick={() => openNote(reference.note_id)}
                      className="group w-full rounded-[24px] border border-slate-200 bg-white/92 p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_18px_35px_-28px_rgba(2,132,199,0.8)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sky-700">
                            {reference.source_type === "file" ? (
                              <DescriptionOutlinedIcon sx={{ fontSize: 18 }} />
                            ) : (
                              <MenuBookRoundedIcon sx={{ fontSize: 18 }} />
                            )}
                            <span className="text-xs font-semibold uppercase tracking-[0.24em]">
                              {reference.source_type === "file"
                                ? "Attachment source"
                                : "Note source"}
                            </span>
                          </div>
                          <h4 className="mt-3 text-base font-semibold text-slate-900">
                            {reference.note_title}
                          </h4>
                          <p className="mt-1 text-sm text-slate-500">
                            {buildSourceMeta(reference)}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-100">
                            {Math.round(reference.similarity_score * 100)}% match
                          </span>
                          <LaunchRoundedIcon className="text-slate-300 transition-colors group-hover:text-sky-600" />
                        </div>
                      </div>

                      <p className="reference-excerpt mt-4 text-sm leading-6 text-slate-600">
                        {reference.excerpt}
                      </p>
                    </button>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/80 p-5 text-sm leading-6 text-slate-500">
                    No direct source excerpts were returned for this answer.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {aiAnswer ? "Referenced Notes" : "My Notes"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {aiAnswer
                ? `${filteredNotes.length} note${
                    filteredNotes.length === 1 ? "" : "s"
                  } connected to the AI answer`
                : "Your saved notes stay here while AI search adds context above."}
            </p>
          </div>
        </div>

        {filteredNotes.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/70 px-5 py-8 text-center text-slate-500 shadow-sm">
            No notes found.
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5">
            {filteredNotes.map((note, index) => (
              <ShowNote
                note={note}
                lineLength={5}
                key={index}
                onEdit={() => openNote(note.id)}
                onDelete={async () => {
                  await deleteNote(note.id);
                  dispatch(deleteNoteAction(note.id));
                }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
