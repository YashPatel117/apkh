"use client";

import { useCallback } from "react";
import { createFolder, deleteFolder, updateFolder } from "@/services/folderService";
import { moveNote as moveNoteRequest } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { useAppDispatch, useAppStore } from "@/store/hook";
import { addNote } from "@/store/slices/noteSlice";
import { refreshLibraryMeta } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/Toast";
import { folderAndDescendants } from "@/lib/folders";
import { MessageKey, useT } from "@/i18n";

/**
 * Filing notes and managing folders. Each action updates the sidebar's
 * folders and counts, and reports failures as a toast (returning false).
 */
export function useFolderActions() {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const toast = useToast();
  const t = useT();

  const run = useCallback(
    async (action: () => Promise<unknown>, failure: MessageKey, success?: string) => {
      try {
        await action();
        if (success) toast(success, "success");
        await refreshLibraryMeta(dispatch).catch(() => {});
        return true;
      } catch (error) {
        toast(getErrorMessage(error, t(failure)), "error");
        return false;
      }
    },
    [dispatch, toast, t],
  );

  const folderName = useCallback(
    (id: string | null) => (id ? store.getState().note.folders.find((f) => f.id === id)?.name : null) ?? t("move.none"),
    [store, t],
  );

  /** Files a note in a folder (null: in no folder). */
  const moveNote = useCallback(
    (noteId: string, folderId: string | null) => {
      const note = store.getState().note.byId[noteId];
      if (note && (note.folderId ?? null) === folderId) return Promise.resolve(true);
      return run(
        async () => dispatch(addNote(await moveNoteRequest(noteId, folderId))),
        "move.failed",
        folderId ? t("move.moved", { name: folderName(folderId) }) : t("move.out"),
      );
    },
    [dispatch, store, run, folderName, t],
  );

  const create = useCallback(
    (name: string, parentId: string | null = null) => run(() => createFolder(name.trim(), parentId), "folders.createFailed"),
    [run],
  );

  const rename = useCallback((id: string, name: string) => run(() => updateFolder(id, { name: name.trim() }), "folders.renameFailed"), [run]);

  /** Moves a folder into another (null: to the top level). */
  const moveFolder = useCallback(
    (id: string, parentId: string | null) => {
      const folders = store.getState().note.folders;
      const folder = folders.find((f) => f.id === id);
      if (!folder || (folder.parentId ?? null) === parentId) return Promise.resolve(true);
      if (parentId && folderAndDescendants(folders, id).has(parentId)) {
        toast(t("folders.notInside"), "info");
        return Promise.resolve(false);
      }
      return run(() => updateFolder(id, { parentId }), "folders.moveFailed");
    },
    [store, run, toast, t],
  );

  const remove = useCallback(
    (id: string) => run(() => deleteFolder(id), "folders.deleteFailed", t("folders.deleted")),
    [run, t],
  );

  return { moveNote, create, rename, moveFolder, remove };
}
