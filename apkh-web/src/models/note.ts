import type { LlmProvider } from "./user";

export interface INote {
  id: string;
  title: string;
  content: string;
  category: string;
  /** Lowercase, hyphenated labels; missing on notes saved offline */
  tags?: string[];
  /** Folder (collection) the note is filed in; null at the top level */
  folderId?: string | null;
  createdAt: string;
  updatedAt: string;
  files: string[];
  /** Whose note it is; in a folder shared with you, someone else's */
  ownerId?: string;
  /** Who saved it last (shown on shared notes) */
  lastEditedBy?: { id: string; name: string } | null;
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

/** What you may do in a folder: your own, or one shared with you. */
export type FolderRole = "owner" | "editor" | "viewer";

export interface IFolder {
  id: string;
  name: string;
  parentId: string | null;
  /** Notes filed directly in this folder */
  noteCount: number;
  /** Missing from older servers: treated as your own */
  role?: FolderRole;
  /** Your folders: how many people it is shared with (or offered to) */
  sharedWith?: number;
  /** Shared with you: whose it is */
  ownerId?: string;
  ownerName?: string;
  /** Shared with you: the folder that was shared (shown under "Shared with me") */
  shareRoot?: boolean;
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
  /** Who wrote this version, when known */
  editedByName?: string | null;
}

/** queued / processing: being indexed · ready: searchable · failed / skipped: not indexed */
export type IndexJobStatus = "queued" | "processing" | "ready" | "failed" | "skipped";

export type IndexedFileStatus = "ok" | "empty" | "unsupported" | "no_vision" | "no_audio" | "missing" | "failed";

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
  /** Left out (offline saves), the note's tags stay as they are */
  tags?: string[];
  /** New notes: the folder to file them in */
  folderId?: string | null;
  files?: File[];
  removedFiles?: string[];
}
