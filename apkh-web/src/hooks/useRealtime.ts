"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL } from "@/services/axios";
import { profile } from "@/services/authService";
import { getChatSessions } from "@/services/chatService";
import { getIndexStatus, getNotesPage } from "@/services/noteService";
import { useAppDispatch } from "@/store/hook";
import { setUser } from "@/store/slices/authSlice";
import { setSessions } from "@/store/slices/chatSlice";
import { addNote, deleteNote, setFirstPage, setIndexStatus } from "@/store/slices/noteSlice";
import { refreshLibraryMeta } from "@/hooks/useAuth";
import type { INote } from "@/models/note";

/** Fired on window when a conversation changes elsewhere; the chat page reloads it. */
export const CHAT_UPDATED_EVENT = "kh:chat-updated";

/** Runs `fn` once, `ms` after the last call (bursts of events become one reload). */
function debounce(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
  run.cancel = () => clearTimeout(timer);
  return run;
}

/**
 * Live sync: the API pushes every change to the user's data (from this tab,
 * other tabs and other devices) over a WebSocket, so notes, folders, index
 * status, chats and the profile update without polling.
 */
export function useRealtime(enabled: boolean) {
  const dispatch = useAppDispatch();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const token = localStorage.getItem("token");
    if (!token) return;

    const socket = io(`${API_URL}/realtime`, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnectionDelayMax: 30_000,
    });
    socketRef.current = socket;

    const refreshMeta = debounce(() => refreshLibraryMeta(dispatch).catch(() => {}), 400);
    const refreshIndex = debounce(
      () =>
        getIndexStatus()
          .then((status) => dispatch(setIndexStatus(status)))
          .catch(() => {}),
      500,
    );
    const refreshSessions = debounce(
      () =>
        getChatSessions()
          .then((sessions) => dispatch(setSessions(sessions)))
          .catch(() => {}),
      400,
    );
    const refreshProfile = debounce(
      () =>
        profile()
          .then((user) => dispatch(setUser(user)))
          .catch(() => {}),
      800,
    );
    const reloadNotes = debounce(() => {
      getNotesPage()
        .then((page) => dispatch(setFirstPage(page)))
        .catch(() => {});
      refreshMeta();
    }, 400);

    socket.on("connect", () => {
      setConnected(true);
      // Catch up on anything missed while disconnected.
      refreshIndex();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("note:saved", (note: INote) => {
      dispatch(addNote(note));
      refreshMeta();
    });
    socket.on("note:deleted", ({ id }: { id: string }) => {
      dispatch(deleteNote(id));
      refreshMeta();
    });
    socket.on("notes:refresh", reloadNotes);
    socket.on("folders:changed", refreshMeta);
    socket.on("index:changed", refreshIndex);
    socket.on("profile:changed", refreshProfile);
    socket.on("chat:updated", (detail: { sessionId: string; deleted?: boolean }) => {
      refreshSessions();
      window.dispatchEvent(new CustomEvent(CHAT_UPDATED_EVENT, { detail }));
    });

    return () => {
      for (const fn of [refreshMeta, refreshIndex, refreshSessions, refreshProfile, reloadNotes]) fn.cancel();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [enabled, dispatch]);

  return { connected };
}
