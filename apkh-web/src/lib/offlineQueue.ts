import type { INoteDto } from "@/models/note";
import { localized } from "@/lib/localizedError";

const KEY = "offline-queue";
export const OFFLINE_ID_PREFIX = "offline-";

/** A note saved while offline, sent when the connection is back. */
export interface QueuedSave {
  /** The note's id: a real one for an edit, an "offline-…" one for a new note */
  noteId: string;
  data: Omit<INoteDto, "files" | "removedFiles">;
  queuedAt: string;
}

export function isOfflineId(id: string) {
  return id.startsWith(OFFLINE_ID_PREFIX);
}

export function newOfflineId() {
  return `${OFFLINE_ID_PREFIX}${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

export function readQueue(): QueuedSave[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedSave[];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedSave[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // Storage full: the save is lost; callers check the result of enqueueSave.
    throw localized("There's no room to keep this change offline.", "offline.noRoom");
  }
  window.dispatchEvent(new Event("offline-queue-changed"));
}

/** Queues a save; a later save of the same note replaces the earlier one. */
export function enqueueSave(save: QueuedSave) {
  writeQueue([...readQueue().filter((s) => s.noteId !== save.noteId), save]);
}

export function removeFromQueue(noteId: string) {
  writeQueue(readQueue().filter((s) => s.noteId !== noteId));
}

/** True when the error means "no connection" (as opposed to a server error). */
export function isNetworkError(error: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const e = error as { isAxiosError?: boolean; response?: unknown; code?: string };
  return Boolean(e?.isAxiosError && !e.response && e.code !== "ERR_CANCELED");
}
