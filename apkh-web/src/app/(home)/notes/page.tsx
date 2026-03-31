"use client";

import { useAppDispatch, useAppSelector } from "@/store/hook";
import { ShowNote } from "@/app/common/components/showNote";
import { useContext } from "react";
import { NotesContext } from "@/app/common/context/notesContext";
import { deleteNote as deleteNoteAction } from "@/store/slices/noteSlice";
import { deleteNote } from "@/service/noteService";
import { CircularProgress } from "@mui/material";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import ReactMarkdown from 'react-markdown';

export default function NotesPage() {
  const { notes } = useAppSelector((state) => state.note);
  const { openNote, filteredNotes, aiAnswer, isAiSearching } = useContext(NotesContext);
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
        {isAiSearching && (
          <div className="mb-8 p-6 bg-blue-50/50 rounded-xl border border-blue-100 flex items-center justify-center gap-4 text-blue-800">
            <CircularProgress size={24} />
            <span className="font-medium">Searching and reading your notes...</span>
          </div>
        )}

        {aiAnswer && !isAiSearching && (
          <div className="mb-8 p-6 bg-gradient-to-br from-blue-50 to-white rounded-xl border border-blue-200 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <AutoAwesomeOutlinedIcon sx={{ fontSize: 100 }} />
            </div>
            <div className="flex items-center gap-2 mb-4 text-blue-700">
              <AutoAwesomeOutlinedIcon />
              <h2 className="text-xl font-bold">AI Answer</h2>
            </div>
            <div className="prose prose-blue max-w-none text-gray-800 relative z-10">
              <ReactMarkdown>{aiAnswer.answer}</ReactMarkdown>
            </div>
          </div>
        )}

        <h1 className="text-xl font-bold mb-4">My Notes {aiAnswer && <span className="text-gray-500 text-sm font-normal ml-2">({filteredNotes.length} used as reference)</span>}</h1>
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
