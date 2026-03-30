"use client";

import { INote } from "@/app/common/models/note";
import { updateNote } from "@/service/noteService";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface NoteState {
  latestUpdatedAt: string | null;
  notes: INote[];
}

const initialState: NoteState = {
  latestUpdatedAt: null,
  notes: [],
};

const noteSlice = createSlice({
  name: "auth",
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
    },
  },
});

export const { setNotes, addNote, deleteNote } = noteSlice.actions;
export default noteSlice.reducer;
