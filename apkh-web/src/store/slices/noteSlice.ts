"use client";

import { ICategoryCount, IFolder, INote, INotesPage, IndexStatus } from "@/models/note";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { logout } from "./authSlice";

interface NoteState {
  latestUpdatedAt: string | null;
  /** The pages of the library loaded so far, newest change first */
  notes: INote[];
  /** Cursor for the next page; null when everything is loaded */
  nextCursor: string | null;
  /** First page loaded */
  loaded: boolean;
  /** Every note seen (any page, filtered results, opened by id), so it can be opened */
  byId: Record<string, INote>;
  /** Notes in the library, and per category (from the server, not just loaded pages) */
  totalNotes: number;
  categories: ICategoryCount[];
  folders: IFolder[];
  /** Bumped by every create/edit/delete, so filtered views know to refresh */
  revision: number;
  /** Search-index status of every note (null until first loaded) */
  indexStatus: IndexStatus | null;
}

const initialState: NoteState = {
  latestUpdatedAt: null,
  notes: [],
  nextCursor: null,
  loaded: false,
  byId: {},
  totalNotes: 0,
  categories: [],
  folders: [],
  revision: 0,
  indexStatus: null,
};

const byNewest = (a: INote, b: INote) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

const noteSlice = createSlice({
  name: "note",
  initialState,
  reducers: {
    /** The first page of the library (replaces what was loaded). */
    setFirstPage: (state, action: PayloadAction<INotesPage>) => {
      state.notes = action.payload.notes;
      state.nextCursor = action.payload.nextCursor;
      state.totalNotes = action.payload.total;
      state.loaded = true;
      state.latestUpdatedAt = new Date().toISOString();
      for (const note of action.payload.notes) state.byId[note.id] = note;
    },
    appendPage: (state, action: PayloadAction<INotesPage>) => {
      const known = new Set(state.notes.map((n) => n.id));
      state.notes.push(...action.payload.notes.filter((n) => !known.has(n.id)));
      state.nextCursor = action.payload.nextCursor;
      for (const note of action.payload.notes) state.byId[note.id] = note;
    },
    /** Notes seen elsewhere (search results, opened by id): remembered so they can be opened. */
    cacheNotes: (state, action: PayloadAction<INote[]>) => {
      for (const note of action.payload) state.byId[note.id] = note;
    },
    /** A created or saved note. An edit moves it to the top; a move between folders doesn't. */
    addNote: (state, action: PayloadAction<INote>) => {
      const note = action.payload;
      const index = state.notes.findIndex((n) => n.id === note.id);
      const isNew = index === -1 && !state.byId[note.id];
      if (index !== -1) state.notes.splice(index, 1);
      state.notes.push(note);
      state.notes.sort(byNewest);
      state.byId[note.id] = note;
      if (isNew) state.totalNotes++;
      state.latestUpdatedAt = new Date().toISOString();
      state.revision++;
    },
    deleteNote: (state, action: PayloadAction<string>) => {
      const index = state.notes.findIndex((n) => n.id === action.payload);
      if (index !== -1) state.notes.splice(index, 1);
      if (state.byId[action.payload]) {
        delete state.byId[action.payload];
        state.totalNotes = Math.max(0, state.totalNotes - 1);
      }
      state.revision++;
      if (state.indexStatus) {
        const removed = state.indexStatus.notes.find((n) => n.noteId === action.payload);
        if (removed) {
          state.indexStatus.counts[removed.status]--;
          state.indexStatus.notes = state.indexStatus.notes.filter((n) => n.noteId !== action.payload);
        }
      }
    },
    setCategories: (state, action: PayloadAction<{ categories: ICategoryCount[]; total: number }>) => {
      state.categories = action.payload.categories;
      state.totalNotes = action.payload.total;
    },
    setFolders: (state, action: PayloadAction<IFolder[]>) => {
      state.folders = action.payload;
    },
    setIndexStatus: (state, action: PayloadAction<IndexStatus>) => {
      state.indexStatus = action.payload;
    },
    /** Show a just-saved note as indexing until the next status update confirms it. */
    markNoteIndexing: (state, action: PayloadAction<string>) => {
      const status = state.indexStatus;
      if (!status) return;
      const existing = status.notes.find((n) => n.noteId === action.payload);
      if (existing) {
        status.counts[existing.status]--;
        existing.status = "queued";
        existing.error = undefined;
      } else {
        status.notes.push({ noteId: action.payload, status: "queued", chunkCount: 0, files: [] });
      }
      status.counts.queued++;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(logout, () => initialState);
  },
});

export const {
  setFirstPage,
  appendPage,
  cacheNotes,
  addNote,
  deleteNote,
  setCategories,
  setFolders,
  setIndexStatus,
  markNoteIndexing,
} = noteSlice.actions;
export default noteSlice.reducer;
