import { INote, INoteDto } from "@/app/common/models/note";
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
  const res = await storageApi.get(`/files/${noteId}/${fileName}`, {
    responseType: "blob",
  });
  return res;
}

export async function searchNotes(searchQuery: string) {
  const res = await webApi.get(`/notes/search?search=${searchQuery}`);
  return res.data as INote[];
}
