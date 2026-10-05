"use client";
import { createContext, useContext } from "react";
import { INote } from "@/models/note";
import { AiSearchResponse } from "@/services/noteService";
import type { FolderFilter } from "@/hooks/useNotesFilter";

export interface SelectedNote {
  noteId: string;
  title: string;
}

export interface NotesContextType {
  /** Notes after the search text / category / folder / AI-reference filters (pages loaded so far). */
  filteredNotes: INote[];
  /** Notes matching the filters, across all pages */
  filteredTotal: number;
  notesLoaded: boolean;
  /** Filtered results are loading for the first time */
  resultsLoading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  loadingMore: boolean;
  query: string;
  activeCategory: string | null;
  setActiveCategory: (category: string | null) => void;
  activeFolder: FolderFilter;
  setActiveFolder: (folder: FolderFilter) => void;
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
  filteredTotal: 0,
  notesLoaded: false,
  resultsLoading: false,
  hasMore: false,
  loadMore: async () => {},
  loadingMore: false,
  query: "",
  activeCategory: null,
  setActiveCategory: () => {},
  activeFolder: null,
  setActiveFolder: () => {},
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
