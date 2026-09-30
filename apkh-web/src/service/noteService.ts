import { INote, INoteDto, IndexStatus } from "@/app/common/models/note";
import { webApi, storageApi } from "./axios/axios";

export async function getAllNotes() {
  const res = await webApi.get("/notes");
  return (res.data.data as INote[]).sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export async function getNoteLastUpdatedTime() {
  const res = await webApi.get("/notes/last-updated");
  return res.data;
}

export async function getNoteById(id: string) {
  const res = await webApi.get(`/notes/${id}`);
  return res.data;
}

export async function createNote(note: INoteDto) {
  const formData = new FormData();

  formData.append("title", note.title);
  formData.append("content", note.content);
  formData.append("category", note.category);

  if (note.files && note.files.length > 0) {
    note.files.forEach((file) => {
      formData.append("files", file);
    });
  }

  const res = await webApi.post("/notes", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return res.data.data as INote;
}

export async function updateNote(id: string, note: INoteDto) {
  const formData = new FormData();

  formData.append("title", note.title);
  formData.append("content", note.content);
  formData.append("category", note.category);
  if (note.removedFiles?.length)
    formData.append("removedFiles", note.removedFiles?.join(","));

  if (note.files && note.files.length > 0) {
    note.files.forEach((file) => {
      formData.append("files", file);
    });
  }

  const res = await webApi.put(`/notes/${id}`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return res.data.data as INote;
}

export async function deleteNote(id: string) {
  const res = await webApi.delete(`/notes/${id}`);
  return res.data;
}

export async function getFile(noteId: string, fileName: string) {
  const res = await storageApi.get(`/files/${encodeURIComponent(noteId)}/${encodeURIComponent(fileName)}`, {
    responseType: "blob",
  });
  return res;
}

export async function searchNotes(searchQuery: string) {
  const res = await webApi.get("/notes/search", { params: { search: searchQuery } });
  return res.data as INote[];
}

export type AiSearchResponse = {
  query: string;
  answer: string;
  confidence: string;
  isError?: boolean;
  /** Notes still being indexed, whose content the answer could not use yet */
  pendingNotes?: number;
  /** A clearer version of the question that was also searched for */
  searchedFor?: string;
  references: {
    note_id: string;
    note_title: string;
    source_type: string;
    source_name?: string;
    source_page?: number;
    excerpt: string;
    /** Cosine similarity for a meaning match; 0 for a keyword-only match */
    similarity_score: number;
    /** Why the passage was found (older API versions omit it) */
    match?: "semantic" | "keyword" | "both";
    /** The answer cites it as [n], n being its position + 1 */
    cited?: boolean;
  }[];
};

export async function aiSearchNotes(searchQuery: string, referencedNoteIds?: string[]) {
  const res = await webApi.post(`/notes/ai-search`, { query: searchQuery, referencedNoteIds });
  return res.data as AiSearchResponse;
}

/** brief: a compact summary · actions: action items first */
export type SummaryMode = "brief" | "actions";

/** Action items extracted from a note (only what the note says). */
export type NoteActions = {
  tasks: { task: string; owner: string | null; due: string | null; done: boolean }[];
  decisions: string[];
  deadlines: { what: string; when: string }[];
  people: { name: string; role: string | null }[];
};

export type NoteSummaryResponse = {
  noteId: string;
  mode: SummaryMode;
  summary: string;
  actions: NoteActions | null;
  cached: boolean;
  model: string | null;
  generatedAt: string | null;
};

export async function summarizeNote(noteId: string, mode: SummaryMode = "brief") {
  const res = await webApi.post(`/notes/${noteId}/summary`, undefined, { params: { mode } });
  return res.data.data as NoteSummaryResponse;
}

export async function getIndexStatus() {
  const res = await webApi.get("/notes/index-status");
  return res.data as IndexStatus;
}

/** Re-index one note; `force` re-reads its attachments too. */
export async function reindexNote(noteId: string, force = false) {
  await webApi.post(`/notes/${noteId}/reindex`, { force });
}

/** Re-index notes (and attachments) that failed. */
export async function retryFailedIndexing() {
  const res = await webApi.post("/notes/index/retry-failed", {});
  return res.data as IndexStatus;
}

/** Rebuild the whole search index; `force` downloads and reads every attachment again. */
export async function rebuildIndex(force: boolean) {
  const res = await webApi.post("/notes/reindex", { force });
  return res.data as IndexStatus;
}

export type SimilarNotes = {
  /** Compared by meaning (false: by keywords, e.g. with a Claude key) */
  semantic: boolean;
  notes: { noteId: string; noteTitle: string; similarity: number | null; nearDuplicate: boolean }[];
};

export async function getSimilarNotes(noteId: string) {
  const res = await webApi.get(`/notes/${noteId}/similar`);
  return res.data as SimilarNotes;
}
