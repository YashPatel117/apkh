"use client";
import { createContext, useContext } from "react";
import { INote } from "../models/note";
import { AiSearchResponse } from "@/service/noteService";

export interface SelectedNote {
  noteId: string;
  title: string;
}

export interface NotesContextType {
  /** Notes after the search text / category / AI-reference filters. */
  filteredNotes: INote[];
  notesLoaded: boolean;
  query: string;
  activeCategory: string | null;
  setActiveCategory: (category: string | null) => void;
  openNote: (noteId: string) => void;
  newNote: () => void;
  aiAnswer: AiSearchResponse | null;
  aiFailed: boolean;
  isAiSearching: boolean;
  openAnswer: () => void;
  clearSearch: () => void;
  selectedNotes: SelectedNote[];
  toggleSelect: (noteId: string, title: string) => void;
  focusSearch: () => void;
}

export const NotesContext = createContext<NotesContextType>({
  filteredNotes: [],
  notesLoaded: false,
  query: "",
  activeCategory: null,
  setActiveCategory: () => {},
  openNote: () => {},
  newNote: () => {},
  aiAnswer: null,
  aiFailed: false,
  isAiSearching: false,
  openAnswer: () => {},
  clearSearch: () => {},
  selectedNotes: [],
  toggleSelect: () => {},
  focusSearch: () => {},
});

export const useNotes = () => useContext(NotesContext);
