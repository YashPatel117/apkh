"use client";

import { useAppDispatch, useAppSelector } from "@/store/hook";
import { ShowNote } from "@/app/common/components/showNote";
import { useContext } from "react";
import { NotesContext } from "@/app/common/context/notesContext";
import { deleteNote as deleteNoteAction } from "@/store/slices/noteSlice";
import { deleteNote } from "@/service/noteService";

export default function NotesPage() {
  const { notes } = useAppSelector((state) => state.note);
  const { openNote, filteredNotes } = useContext(NotesContext);
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
      <div className="p-4">
        <h1 className="text-xl font-bold mb-4">My Notes</h1>
        {filteredNotes.length === 0 ? (
          <p>No notes found.</p>
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
