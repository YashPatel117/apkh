"use client";
import { createContext } from "react";
import { INote } from "../models/note";

export interface NotesContextType {
  filteredNotes: INote[];
  openNote: (noteId: string) => void;
}

export const NotesContext = createContext<NotesContextType>({
  openNote: (noteId: string) => {},
  filteredNotes: [],
});
