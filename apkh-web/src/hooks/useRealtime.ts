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
import { addNote, deleteNote, setFirstPage, setIndexStatus, sharedNoteSaved } from "@/store/slices/noteSlice";
import { useAppSelector } from "@/store/hook";
import { isOwnNote } from "@/lib/sharing";
import { refreshLibraryMeta } from "@/hooks/useAuth";
import type { INote } from "@/models/note";

/** Fired on window when a conversation changes elsewhere; the chat page reloads it. */
export const CHAT_UPDATED_EVENT = "kh:chat-updated";
/** Fired on window when the trash changes; the trash page reloads. */
export const TRASH_CHANGED_EVENT = "kh:trash-changed";
/** Fired on window when a notification arrives or is read; the bell reloads. */
export const NOTIFICATIONS_CHANGED_EVENT = "kh:notifications-changed";
/** Fired on window when folder sharing changes (invites, members, roles). */
export const SHARES_CHANGED_EVENT = "kh:shares-changed";

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
  // Read inside socket handlers, which are set up once.
  const userId = useAppSelector((state) => state.auth.user?.id);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

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
      // Notes of folders shared with the user stay out of their own library.
      dispatch(isOwnNote(note, userIdRef.current) ? addNote(note) : sharedNoteSaved(note));
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
    socket.on("trash:changed", () => window.dispatchEvent(new Event(TRASH_CHANGED_EVENT)));
    socket.on("notifications:changed", () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT)));
    socket.on("shares:changed", () => {
      refreshMeta();
      window.dispatchEvent(new Event(SHARES_CHANGED_EVENT));
    });
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
