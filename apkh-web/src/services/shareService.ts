import { API_URL, webApi } from "@/services/axios";

export interface NoteShare {
  noteId: string;
  /** Only in the list of every link */
  noteTitle?: string;
  token: string;
  /** null: until revoked */
  expiresAt: string | null;
  createdAt: string;
  views: number;
  lastViewedAt: string | null;
}

/** A shared note as anyone with the link sees it. */
export interface SharedNote {
  title: string;
  category: string;
  tags: string[];
  content: string;
  files: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

/** The page anyone with the link can open. */
export function shareUrl(token: string) {
  return `${window.location.origin}/share/${token}`;
}

/** One attachment of a shared note (no sign-in needed). */
export function sharedFileUrl(token: string, fileName: string) {
  return `${API_URL}/shared/${encodeURIComponent(token)}/files/${encodeURIComponent(fileName)}`;
}

/** The note's working link, or null. */
export async function getNoteShare(noteId: string) {
  const res = await webApi.get(`/notes/${noteId}/share`);
  return res.data.data as NoteShare | null;
}

/** A new link (the old one stops working); `expiresInDays` null: until revoked. */
export async function createNoteShare(noteId: string, expiresInDays: number | null) {
  const res = await webApi.post(`/notes/${noteId}/share`, { expiresInDays });
  return res.data.data as NoteShare;
}

export async function revokeNoteShare(noteId: string) {
  await webApi.delete(`/notes/${noteId}/share`);
}

/** Every link the user has shared that still works. */
export async function getNoteShares() {
  const res = await webApi.get("/notes/shares");
  return res.data.data as NoteShare[];
}

export async function getSharedNote(token: string) {
  const res = await webApi.get(`/shared/${encodeURIComponent(token)}`);
  return res.data.data as SharedNote;
}
