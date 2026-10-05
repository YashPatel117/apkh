import type { LlmProvider } from "./user";

export interface INote {
  id: string;
  title: string;
  content: string;
  category: string;
  /** Folder (collection) the note is filed in; null at the top level */
  folderId?: string | null;
  createdAt: string;
  updatedAt: string;
  files: string[];
}

/** One page of notes (GET /notes?limit=…). */
export interface INotesPage {
  notes: INote[];
  nextCursor: string | null;
  total: number;
}

export interface ICategoryCount {
  name: string;
  count: number;
}

export interface IFolder {
  id: string;
  name: string;
  parentId: string | null;
  /** Notes filed directly in this folder */
  noteCount: number;
}

/** An earlier version of a note (content only when fetched on its own). */
export interface INoteVersion {
  id: string;
  title: string;
  category: string;
  /** When this version was the current one */
  savedAt: string;
  /** When it was replaced by an edit */
  replacedAt: string;
  size?: number;
  content?: string;
}

/** queued / processing: being indexed · ready: searchable · failed / skipped: not indexed */
export type IndexJobStatus = "queued" | "processing" | "ready" | "failed" | "skipped";

export type IndexedFileStatus = "ok" | "empty" | "unsupported" | "no_vision" | "missing" | "failed";

/** Search-index state of one note. `files` lists only attachments with a problem. */
export interface NoteIndexState {
  noteId: string;
  status: IndexJobStatus;
  error?: string;
  chunkCount: number;
  indexedAt?: string;
  files: { name: string; status: IndexedFileStatus; warning?: string; error?: string }[];
}

export interface IndexStatus {
  provider: LlmProvider | null;
  /** The active provider has an embedding model (otherwise keyword search only) */
  semantic: boolean;
  counts: Record<IndexJobStatus, number>;
  notes: NoteIndexState[];
}

export interface INoteDto {
  title: string;
  content: string;
  category: string;
  /** New notes: the folder to file them in */
  folderId?: string | null;
  files?: File[];
  removedFiles?: string[];
}
