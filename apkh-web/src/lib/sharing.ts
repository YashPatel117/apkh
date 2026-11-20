import type { FolderRole, IFolder, INote } from "@/models/note";
import { useAppSelector } from "@/store/hook";

/** Whether a note is the user's own (not one from a folder shared with them). */
export function isOwnNote(note: Pick<INote, "ownerId">, userId: string | undefined) {
  return !note.ownerId || !userId || note.ownerId === userId;
}

/** What the user may do with a note: own it, edit it (editor) or only read it (viewer). */
export function noteRole(note: Pick<INote, "ownerId" | "folderId">, folders: IFolder[], userId: string | undefined): FolderRole {
  if (isOwnNote(note, userId)) return "owner";
  const folder = note.folderId ? folders.find((f) => f.id === note.folderId) : undefined;
  return folder?.role ?? "viewer";
}

export const canEditRole = (role: FolderRole) => role !== "viewer";

/** noteRole for the signed-in user. */
export function useNoteRole(note: Pick<INote, "ownerId" | "folderId"> | null | undefined): FolderRole {
  const userId = useAppSelector((state) => state.auth.user?.id);
  const folders = useAppSelector((state) => state.note.folders);
  return note ? noteRole(note, folders, userId) : "owner";
}

/** The role of a folder (your own unless the server says otherwise). */
export const folderRole = (folder: Pick<IFolder, "role"> | undefined): FolderRole => folder?.role ?? "owner";
