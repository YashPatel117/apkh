"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createNote, updateNote } from "@/services/noteService";
import { useAppDispatch, useAppStore } from "@/store/hook";
import { addNote, deleteNote, markNoteIndexing } from "@/store/slices/noteSlice";
import { isNetworkError, isOfflineId, readQueue, removeFromQueue } from "@/lib/offlineQueue";

/**
 * Connection state, and the notes saved while offline: they are sent as soon
 * as the browser is back online (or the app opens online).
 */
export function useOfflineSync(enabled: boolean, onSynced?: (count: number) => void) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const syncing = useRef(false);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  const flush = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return;
    syncing.current = true;
    let sent = 0;
    try {
      for (const save of readQueue()) {
        try {
          const dto = { ...save.data, files: [], removedFiles: [] };
          const saved = isOfflineId(save.noteId) ? await createNote(dto) : await updateNote(save.noteId, dto);
          removeFromQueue(save.noteId);
          if (isOfflineId(save.noteId)) dispatch(deleteNote(save.noteId));
          dispatch(addNote(saved));
          dispatch(markNoteIndexing(saved.id));
          sent++;
        } catch (error) {
          if (isNetworkError(error)) break; // still offline: try again later
          // The server refused it (e.g. the note was deleted elsewhere): drop it.
          removeFromQueue(save.noteId);
        }
      }
    } finally {
      syncing.current = false;
      setPending(readQueue().length);
      if (sent) onSyncedRef.current?.(sent);
    }
  }, [dispatch]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const count = () => setPending(readQueue().length);
    update();
    count();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("offline-queue-changed", count);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("offline-queue-changed", count);
    };
  }, []);

  // Saves still waiting (e.g. after a reload while offline) show in the list.
  useEffect(() => {
    if (!enabled) return;
    const { byId } = store.getState().note;
    for (const save of readQueue()) {
      const existing = byId[save.noteId];
      dispatch(
        addNote({
          files: existing?.files ?? [],
          createdAt: existing?.createdAt ?? save.queuedAt,
          ...save.data,
          id: save.noteId,
          updatedAt: save.queuedAt,
        }),
      );
    }
  }, [enabled, dispatch, store]);

  useEffect(() => {
    if (enabled && online) void flush();
  }, [enabled, online, flush]);

  return { online, pending };
}
