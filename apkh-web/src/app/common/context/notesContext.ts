"use client";
import { createContext } from "react";
import { INote } from "../models/note";
import { AiSearchResponse } from "@/service/noteService";

export interface NotesContextType {
  filteredNotes: INote[];
  openNote: (noteId: string) => void;
  aiAnswer?: AiSearchResponse | null;
  isAiSearching?: boolean;
}

export const NotesContext = createContext<NotesContextType>({
  openNote: (noteId: string) => {},
  filteredNotes: [],
  aiAnswer: null,
  isAiSearching: false,
});
