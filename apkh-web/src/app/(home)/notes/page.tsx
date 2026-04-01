"use client";

import { ShowNote } from "@/app/common/components/showNote";
import { useContext } from "react";
import { NotesContext } from "@/app/common/context/notesContext";
import { useAppDispatch } from "@/store/hook";
import { deleteNote as deleteNoteAction } from "@/store/slices/noteSlice";
import { deleteNote } from "@/service/noteService";

export default function NotesPage() {
  const { openNote, filteredNotes, aiAnswer } = useContext(NotesContext);
  const dispatch = useAppDispatch();

  return (
    <>
      <style>{`
        .card {
          flex: 1;
          max-width: 500px;
          min-width: 300px;
        }
        @media (max-width: 350px) {
          .card {
            min-width: 200px;
            width: auto;
          }
        }
      `}</style>

      <div className="p-4 sm:px-6 sm:pb-8">
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
