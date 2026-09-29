"use client";

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { IChatSession, IChatMessage } from "@/service/chatService";
import { logout } from "./authSlice";

interface ChatState {
  sessions: IChatSession[];
  activeSessionId: string | null;
  messages: IChatMessage[];
  isLoading: boolean;
}

const initialState: ChatState = {
  sessions: [],
  activeSessionId: null,
  messages: [],
  isLoading: false,
};

const chatSlice = createSlice({
  name: "chat",
  initialState,
  reducers: {
    setSessions: (state, action: PayloadAction<IChatSession[]>) => {
      state.sessions = action.payload;
    },
    addSession: (state, action: PayloadAction<IChatSession>) => {
      state.sessions = state.sessions.filter((s) => s.id !== action.payload.id);
      state.sessions.unshift(action.payload);
    },
    updateSessionTime: (state, action: PayloadAction<string>) => {
      const session = state.sessions.find((s) => s.id === action.payload);
      if (session) {
        session.updatedAt = new Date().toISOString();
        session.messageCount += 2;
        // Move to the top
        state.sessions = state.sessions.filter((s) => s.id !== action.payload);
        state.sessions.unshift(session);
      }
    },
    removeSession: (state, action: PayloadAction<string>) => {
      state.sessions = state.sessions.filter((s) => s.id !== action.payload);
      if (state.activeSessionId === action.payload) {
        state.activeSessionId = state.sessions.length > 0 ? state.sessions[0].id : null;
        state.messages = [];
      }
    },
    setActiveSession: (state, action: PayloadAction<string | null>) => {
      state.activeSessionId = action.payload;
    },
    setMessages: (state, action: PayloadAction<IChatMessage[]>) => {
      state.messages = action.payload;
    },
    addMessage: (state, action: PayloadAction<IChatMessage>) => {
      state.messages.push(action.payload);
    },
    removeMessage: (state, action: PayloadAction<string>) => {
      state.messages = state.messages.filter((m) => m.id !== action.payload);
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
  },
  extraReducers: (builder) => {
    // Never leak one user's conversations into the next session.
    builder.addCase(logout, () => initialState);
  },
});

export const {
  setSessions,
  addSession,
  removeSession,
  setActiveSession,
  setMessages,
  addMessage,
  removeMessage,
  setLoading,
  updateSessionTime
} = chatSlice.actions;

export default chatSlice.reducer;
