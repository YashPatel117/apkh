export interface INote {
  id: string;
  title: string;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  files: string[];
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
  provider: "gemini" | "openai" | "anthropic" | null;
  /** The active provider has an embedding model (otherwise keyword search only) */
  semantic: boolean;
  counts: Record<IndexJobStatus, number>;
  notes: NoteIndexState[];
}

export interface INoteDto {
  title: string;
  content: string;
  category: string;
  files?: File[];
  removedFiles?: string[];
}
