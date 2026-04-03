"use client";

import { ShowNote } from "@/app/common/components/showNote";
import { useContext } from "react";
import { NotesContext } from "@/app/common/context/notesContext";
import { useAppDispatch } from "@/store/hook";
import { deleteNote as deleteNoteAction } from "@/store/slices/noteSlice";
import { deleteNote } from "@/service/noteService";

export default function NotesPage() {
  const { openNote, filteredNotes, aiAnswer, selectedNotes, toggleSelect } = useContext(NotesContext);
  const dispatch = useAppDispatch();
  const categoryCount = new Set(
    filteredNotes
      .map((note) => note.category?.trim())
      .filter((category) => Boolean(category))
  ).size;
  const attachmentCount = filteredNotes.reduce(
    (total, note) => total + note.files.length,
    0
  );


  return (
    <div className="p-4 sm:px-6 sm:pb-8">
      <div className="mb-6 rounded-[30px] border border-white/80 bg-[linear-gradient(145deg,_rgba(255,255,255,0.94),_rgba(240,249,255,0.94)_48%,_rgba(224,242,254,0.92)_100%)] shadow-[0_26px_80px_-54px_rgba(14,116,144,0.65)]">
        <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)] lg:px-6 lg:py-6">
          <div>
            <div className="inline-flex items-center rounded-full border border-sky-200 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">
              {aiAnswer ? "AI-linked note set" : "Notes workspace"}
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {aiAnswer ? "Referenced notes" : "My Notes"}
            </h1>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <div className="rounded-[22px] border border-white/80 bg-white/80 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                Visible Notes
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900">
                {filteredNotes.length}
              </p>
            </div>
            <div className="rounded-[22px] border border-white/80 bg-white/80 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                Categories
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900">
                {categoryCount}
              </p>
            </div>
            <div className="rounded-[22px] border border-white/80 bg-white/80 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                Attachments
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900">
                {attachmentCount}
              </p>
            </div>
          </div>
        </div>
      </div>

      {filteredNotes.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/75 px-6 py-12 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">No notes found</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Try a different search, clear the AI filter, or create a new note to fill
            this space.
          </p>
        </div>
      ) : (
        <div className="columns-1 gap-5 md:columns-2 xl:columns-3 2xl:columns-4">
          {filteredNotes.map((note) => (
            <ShowNote
              note={note}
              lineLength={5}
              key={note.id}
              selected={selectedNotes.some((selectedNote) => selectedNote.noteId === note.id)}
              onEdit={() => openNote(note.id)}
              toggleSelect={() => toggleSelect(note.id, note.title)}
              onDelete={async () => {
                await deleteNote(note.id);
                dispatch(deleteNoteAction(note.id));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
