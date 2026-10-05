import type { ICategoryCount, IFolder, INote, INotesPage } from "@/models/note";
import type { IUser } from "@/models/user";
import { jwtDecode } from "jwt-decode";

const KEY = "offline-library";
// Enough to read recent notes offline without filling the storage quota.
const MAX_NOTES = 200;

interface CachedLibrary {
  /** Whose library this is (the token's user id) */
  owner: string;
  user: IUser | null;
  page: INotesPage;
  categories: ICategoryCount[];
  folders: IFolder[];
}

/** Keeps the most recent notes in localStorage so the app can show them offline. */
export function saveCachedLibrary(data: {
  user: IUser;
  notes: INote[];
  categories: ICategoryCount[];
  folders: IFolder[];
  total: number;
}) {
  try {
    const owner = tokenOwner();
    if (!owner) return;
    const cached: CachedLibrary = {
      owner,
      user: data.user,
      page: { notes: data.notes.slice(0, MAX_NOTES), nextCursor: null, total: data.total },
      categories: data.categories,
      folders: data.folders,
    };
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Quota or private mode: offline reading just won't be available.
  }
}

/** The signed-in user's cached library (never another user's). */
export function readCachedLibrary(): CachedLibrary | null {
  try {
    const raw = localStorage.getItem(KEY);
    const cached = raw ? (JSON.parse(raw) as CachedLibrary) : null;
    return cached && cached.owner === tokenOwner() ? cached : null;
  } catch {
    return null;
  }
}

function tokenOwner(): string | null {
  try {
    const token = localStorage.getItem("token");
    return token ? String(jwtDecode<{ _id?: string }>(token)._id ?? "") || null : null;
  } catch {
    return null;
  }
}

export function clearCachedLibrary() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
