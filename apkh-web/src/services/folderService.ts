import { IFolder } from "@/models/note";
import { webApi } from "@/services/axios";

export async function getFolders() {
  const res = await webApi.get("/folders");
  return res.data.data as IFolder[];
}

export async function createFolder(name: string, parentId: string | null = null) {
  const res = await webApi.post("/folders", { name, parentId: parentId ?? undefined });
  return res.data.data as { id: string; name: string };
}

/** Rename and/or move (parentId null: to the top level). */
export async function updateFolder(id: string, changes: { name?: string; parentId?: string | null }) {
  const res = await webApi.patch(`/folders/${id}`, changes);
  return res.data.data as { id: string; name: string };
}

/** Its notes and subfolders move up to its parent. */
export async function deleteFolder(id: string) {
  await webApi.delete(`/folders/${id}`);
}
