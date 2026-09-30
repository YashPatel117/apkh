"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Copy, Layers } from "lucide-react";
import { getSimilarNotes, SimilarNotes } from "@/service/noteService";
import { getErrorMessage } from "@/service/axios/axios";
import { Modal } from "../ui/Modal";

/** Notes related to a note, and possible duplicates (roadmap: "Similar notes"). */
export function SimilarNotesModal({
  noteId,
  noteTitle,
  open,
  onClose,
  onOpenNote,
}: {
  noteId: string;
  noteTitle: string;
  open: boolean;
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
}) {
  const [result, setResult] = useState<SimilarNotes | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setResult(null);
    setError("");
    getSimilarNotes(noteId)
      .then((data) => !cancelled && setResult(data))
      .catch((err) => !cancelled && setError(getErrorMessage(err, "Couldn't find similar notes.")));
    return () => {
      cancelled = true;
    };
  }, [open, noteId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <Layers className="size-4 text-accent" /> Similar notes
        </span>
      }
      description={`Notes like “${noteTitle || "Untitled note"}”`}
    >
      <div className="px-5 pb-6 sm:px-6">
        {!result && !error && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        )}
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        {result && result.notes.length === 0 && (
          <p className="text-sm text-fg-muted">No similar notes found. Notes appear here once they&apos;re indexed.</p>
        )}
        {result && result.notes.length > 0 && (
          <ul className="space-y-2">
            {result.notes.map((note) => (
              <li key={note.noteId}>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenNote(note.noteId);
                  }}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-indigo-200 dark:hover:border-indigo-400/30"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{note.noteTitle || "Untitled note"}</span>
                  {note.nearDuplicate ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[0.7rem] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                      <Copy className="size-3" /> Possible duplicate
                    </span>
                  ) : (
                    note.similarity !== null && (
                      <span className="shrink-0 text-xs font-semibold text-fg-subtle tabular-nums">
                        {Math.round(note.similarity * 100)}%
                      </span>
                    )
                  )}
                  <ArrowUpRight className="size-4 shrink-0 text-fg-subtle group-hover:text-accent" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {result && !result.semantic && (
          <p className="mt-4 text-xs text-fg-subtle">
            Compared by shared words. With a Gemini or OpenAI key, notes are compared by meaning.
          </p>
        )}
      </div>
    </Modal>
  );
}
