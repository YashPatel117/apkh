"use client";

import { useCallback, useState } from "react";
import { INote, INoteDto } from "@/models/note";
import { createNote, getNoteById, updateNote } from "@/services/noteService";
import { useAppDispatch, useAppStore } from "@/store/hook";
import { addNote, cacheNotes, markNoteIndexing } from "@/store/slices/noteSlice";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n";
import { enqueueSave, isNetworkError, isOfflineId, newOfflineId } from "@/lib/offlineQueue";
import { refreshLibraryMeta } from "@/hooks/useAuth";

/**
 * The note editor: which note is open, and saving it. Offline, text changes
 * are kept and sent once the connection is back (attachments need a connection).
 */
export function useNoteEditor() {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const toast = useToast();
  const t = useT();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editNote, setEditNote] = useState<INote | null>(null);
  const [newNoteFolder, setNewNoteFolder] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Opens a note, fetching it if it isn't among the notes loaded so far. */
  const openNote = useCallback(
    async (noteId: string) => {
      let note = store.getState().note.byId[noteId];
      if (!note && !isOfflineId(noteId)) {
        try {
          const res = await getNoteById(noteId);
          note = res.data as INote;
          dispatch(cacheNotes([note]));
        } catch {
          note = undefined as unknown as INote;
        }
      }
      if (!note) {
        toast(t("notes.missing"), "error");
        return;
      }
      setEditNote(note);
      setEditorOpen(true);
    },
    [dispatch, store, toast, t],
  );

  /** A new note, filed in `folderId` when given. */
  const newNote = useCallback((folderId: string | null = null) => {
    setEditNote(null);
    setNewNoteFolder(folderId);
    setEditorOpen(true);
  }, []);

  const saveNote = useCallback(
    async (data: INoteDto, id?: string) => {
      setSaving(true);
      const payload = id ? data : { ...data, folderId: newNoteFolder };
      try {
        if (id && isOfflineId(id)) throw Object.assign(new Error("offline"), { offlineNote: true });
        const res = id ? await updateNote(id, payload) : await createNote(payload);
        if (res) {
          dispatch(addNote(res));
          dispatch(markNoteIndexing(res.id));
        }
        setEditorOpen(false);
        toast(id ? t("editor.updated") : t("editor.created"), "success");
        refreshLibraryMeta(dispatch).catch(() => {});
      } catch (error) {
        const offlineNote = (error as { offlineNote?: boolean }).offlineNote;
        if (!offlineNote && !isNetworkError(error)) throw error;
        if (data.files?.length || data.removedFiles?.length) {
          throw new Error(t("offline.attachmentsNeedConnection"));
        }
        // Keep it until the connection is back.
        const noteId = id ?? newOfflineId();
        const now = new Date().toISOString();
        const fields = { title: data.title, content: data.content, category: data.category, folderId: payload.folderId ?? null };
        enqueueSave({ noteId, data: fields, queuedAt: now });
        const existing = store.getState().note.byId[noteId];
        dispatch(addNote({ files: existing?.files ?? [], createdAt: existing?.createdAt ?? now, ...fields, id: noteId, updatedAt: now }));
        setEditorOpen(false);
        toast(t("offline.savedForLater"), "info");
      } finally {
        setSaving(false);
      }
    },
    [dispatch, store, toast, t, newNoteFolder],
  );

  const closeEditor = useCallback(() => setEditorOpen(false), []);

  return { editorOpen, editNote, saving, openNote, newNote, saveNote, closeEditor };
}
