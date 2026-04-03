"use client";
import { createContext } from "react";
import { INote } from "../models/note";
import { AiSearchResponse } from "@/service/noteService";

export interface NotesContextType {
  filteredNotes: INote[];
  openNote: (noteId: string) => void;
  aiAnswer?: AiSearchResponse | null;
  isAiSearching?: boolean;
  selectedNotes: { noteId: string, title: string }[];
  toggleSelect: (noteId: string, title: string) => void;
}

export const NotesContext = createContext<NotesContextType>({
  openNote: (noteId: string) => { },
  filteredNotes: [],
  aiAnswer: null,
  isAiSearching: false,
  selectedNotes: [],
  toggleSelect: (noteId: string, title: string) => { },
});
