"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { FolderOpen, MousePointerClick, Plus, SearchX, Sparkles, X } from "lucide-react";
import { ShowNote } from "@/components/showNote";
import { useNotes } from "@/context/notesContext";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { deleteNote as deleteNoteAction, markNoteIndexing } from "@/store/slices/noteSlice";
import { deleteNote, reindexNote } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { INote } from "@/models/note";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

function NotesSkeleton() {
  return (
    <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
      {[180, 240, 200, 160, 220, 190].map((h, i) => (
        <div key={i} className="mb-4 animate-pulse rounded-3xl border border-line bg-surface" style={{ height: h }} />
      ))}
    </div>
  );
}

export default function NotesPage() {
  const {
    filteredNotes,
    notesLoaded,
    query,
    activeCategory,
    setActiveCategory,
    openNote,
    newNote,
    aiAnswer,
    aiFailed,
    openAnswer,
    clearSearch,
    selectedNotes,
    toggleSelect,
  } = useNotes();
  const totalNotes = useAppSelector((state) => state.note.notes.length);
  const indexStatus = useAppSelector((state) => state.note.indexStatus);
  const indexByNote = useMemo(() => new Map(indexStatus?.notes.map((n) => [n.noteId, n])), [indexStatus]);
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<INote | null>(null);

  const aiLinked = Boolean(aiAnswer && !aiFailed && aiAnswer.references.length);
  const filtering = Boolean(query.trim() || activeCategory || aiLinked);
  const attachmentCount = filteredNotes.reduce((total, note) => total + note.files.length, 0);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteNote(pendingDelete.id);
      dispatch(deleteNoteAction(pendingDelete.id));
      if (selectedNotes.some((n) => n.noteId === pendingDelete.id)) toggleSelect(pendingDelete.id, pendingDelete.title);
      toast("Note deleted.", "success");
    } catch (error) {
      toast(getErrorMessage(error, "Couldn't delete the note."), "error");
      throw error;
    }
  };

  const retryIndexing = async (note: INote) => {
    try {
      await reindexNote(note.id);
      dispatch(markNoteIndexing(note.id));
      toast("Indexing again…", "info");
    } catch (error) {
      toast(getErrorMessage(error, "Couldn't restart indexing."), "error");
    }
  };

  const heading = aiLinked ? "Referenced notes" : activeCategory ? activeCategory : query.trim() ? "Search results" : "My notes";

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-fg sm:text-3xl">{heading}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {notesLoaded ? (
              <>
                {filteredNotes.length} {filteredNotes.length === 1 ? "note" : "notes"}
                {filtering && ` of ${totalNotes}`}
                {attachmentCount > 0 && ` · ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`}
              </>
            ) : (
              "Loading your notes…"
            )}
          </p>
        </div>
        <div className="hidden sm:block">
          <Button onClick={newNote} icon={<Plus className="size-4" />}>
            New note
          </Button>
        </div>
      </div>

      {/* Active filters */}
      {(aiLinked || activeCategory || query.trim()) && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {aiLinked && (
            <div className="flex w-full flex-wrap items-center gap-3 rounded-2xl border border-indigo-200 bg-linear-to-r from-blue-50 via-indigo-50 to-violet-50 px-4 py-3 dark:border-indigo-400/20 dark:from-blue-500/10 dark:via-indigo-500/10 dark:to-violet-500/10">
              <Sparkles className="size-4 shrink-0 text-accent" />
              <p className="min-w-0 flex-1 text-sm text-fg">
                Showing notes the AI used to answer <span className="font-semibold">“{aiAnswer!.query}”</span>
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="soft" onClick={openAnswer}>
                  View answer
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSearch} icon={<X className="size-3.5" />}>
                  Clear
                </Button>
              </div>
            </div>
          )}
          {!aiLinked && activeCategory && (
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface py-1 pr-2 pl-3 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              <FolderOpen className="size-3.5" />
              <span>{activeCategory}</span>
              <X className="size-3.5" />
              <span className="sr-only">Remove category filter</span>
            </button>
          )}
          {!aiLinked && query.trim() && (
            <button
              type="button"
              onClick={clearSearch}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface py-1 pr-2 pl-3 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              “{query.trim()}”
              <X className="size-3.5" />
              <span className="sr-only">Clear search</span>
            </button>
          )}
        </div>
      )}

      {/* Selected-for-AI hint */}
      {selectedNotes.length > 0 && !aiLinked && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-xs font-medium text-accent-fg">
          <MousePointerClick className="size-3.5" />
          {selectedNotes.length} note{selectedNotes.length === 1 ? "" : "s"} pinned — your next AI question will focus on{" "}
          {selectedNotes.length === 1 ? "it" : "them"}.
        </p>
      )}

      <div className="mt-6">
        {!notesLoaded ? (
          <NotesSkeleton />
        ) : totalNotes === 0 ? (
          <div className="mx-auto flex max-w-md animate-rise flex-col items-center py-10 text-center">
            <Image
              src="/assets/empty-state.jpg"
              alt=""
              width={512}
              height={512}
              priority
              className="size-56 rounded-[2.5rem] object-cover shadow-xl shadow-indigo-500/10 sm:size-64"
            />
            <h2 className="mt-8 text-xl font-bold tracking-tight text-fg">No notes yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              Write your first note or drop in a PDF. Everything you add is indexed so you can ask questions about it
              later.
            </p>
            <Button onClick={newNote} size="lg" className="mt-6" icon={<Plus className="size-4" />}>
              Create your first note
            </Button>
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-line px-6 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-fg-subtle">
              <SearchX className="size-5" />
            </span>
            <h2 className="mt-4 font-semibold text-fg">No matching notes</h2>
            <p className="mt-1 max-w-sm text-sm text-fg-muted">
              Nothing matches your filters. Try different words, or press <span className="font-semibold">Ask AI</span> to
              search by meaning instead.
            </p>
            <Button
              variant="secondary"
              className="mt-5"
              onClick={() => {
                clearSearch();
                setActiveCategory(null);
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
            {filteredNotes.map((note, i) => (
              <ShowNote
                key={note.id}
                note={note}
                index={i}
                selected={selectedNotes.some((s) => s.noteId === note.id)}
                indexState={indexByNote.get(note.id)}
                onReindex={() => void retryIndexing(note)}
                onEdit={() => openNote(note.id)}
                onToggleSelect={() => toggleSelect(note.id, note.title)}
                onDelete={() => setPendingDelete(note)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Mobile create button — sits above content, page has bottom padding to clear it */}
      <div className="fixed right-5 bottom-5 z-30 sm:hidden">
        <Button onClick={newNote} size="fab" aria-label="New note">
          <Plus className="size-6" />
        </Button>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this note?"
        message={
          <>
            <span className="font-semibold text-fg">“{pendingDelete?.title || "Untitled note"}”</span> and its attachments
            will be permanently removed from your hub and AI index.
          </>
        }
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
