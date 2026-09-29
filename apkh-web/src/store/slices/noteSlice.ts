"use client";

import { INote, IndexStatus } from "@/app/common/models/note";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { logout } from "./authSlice";

interface NoteState {
  latestUpdatedAt: string | null;
  notes: INote[];
  /** Search-index status of every note (null until first loaded) */
  indexStatus: IndexStatus | null;
}

const initialState: NoteState = {
  latestUpdatedAt: null,
  notes: [],
  indexStatus: null,
};

const noteSlice = createSlice({
  name: "note",
  initialState,
  reducers: {
    setNotes: (state, action: PayloadAction<NoteState["notes"]>) => {
      state.notes = action.payload.sort((a, b) => {
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
      state.latestUpdatedAt = new Date().toISOString();
    },
    addNote: (state, action: PayloadAction<NoteState["notes"][0]>) => {
      const index = state.notes.findIndex((n) => n.id === action.payload.id);
      if (index !== -1) state.notes.splice(index, 1);
      state.notes.unshift(action.payload); // add to start
      state.latestUpdatedAt = new Date().toISOString();
    },
    deleteNote: (state, action: PayloadAction<string>) => {
      const index = state.notes.findIndex((n) => n.id === action.payload);
      if (index !== -1) state.notes.splice(index, 1);
      if (state.indexStatus) {
        const removed = state.indexStatus.notes.find((n) => n.noteId === action.payload);
        if (removed) {
          state.indexStatus.counts[removed.status]--;
          state.indexStatus.notes = state.indexStatus.notes.filter((n) => n.noteId !== action.payload);
        }
      }
    },
    setIndexStatus: (state, action: PayloadAction<IndexStatus>) => {
      state.indexStatus = action.payload;
    },
    /** Show a just-saved note as indexing until the next status poll confirms it. */
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

export const { setNotes, addNote, deleteNote, setIndexStatus, markNoteIndexing } = noteSlice.actions;
export default noteSlice.reducer;
